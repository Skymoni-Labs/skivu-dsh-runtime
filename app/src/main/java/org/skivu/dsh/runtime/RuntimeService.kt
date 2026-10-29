package org.skivu.dsh.runtime

import android.app.Service
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.pm.ServiceInfo
import android.content.Intent
import android.content.pm.PackageManager
import android.os.*
import java.io.File
import java.io.FileInputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

class RuntimeService : Service() {
    companion object { const val PERMISSION="org.skivu.permission.RUN_RUNTIME";const val STOP="org.skivu.dsh.runtime.STOP" }
    private class Lease(val uid: Int,val token:String,val reply:Messenger) {
        @Volatile var cancelled=false
        @Volatile var ready=false
        var stopStarted=false
        var stopFinished=false
        var stopResult=false
        val stopReplies=mutableListOf<Messenger>()
        var pid=-1
        val lock=Any()
    }
    private val active=AtomicReference<Lease?>()
    private val startup=Executors.newSingleThreadExecutor()
    private val cleanup=Executors.newSingleThreadExecutor()
    private val native=NativeRunner()
    private val handler=Handler(Looper.getMainLooper())
    private val messenger=Messenger(Handler(Looper.getMainLooper()) { message ->
        if(checkPermission(PERMISSION,-1,message.sendingUid)!=PackageManager.PERMISSION_GRANTED) return@Handler true
        val data=message.data
        val token=data.getString("token") ?: return@Handler true
        if(!Regex("[0-9a-f-]{36}").matches(token)) return@Handler true
        if(message.what==4) {
            val lease=active.get()
            if(lease!=null && lease.uid==message.sendingUid && lease.token==token) stop(lease,message.replyTo)
            return@Handler true
        }
        if(message.what!=1) return@Handler true
        val receiver=message.replyTo ?: return@Handler true
        val lease=Lease(message.sendingUid,token,receiver)
        if(!active.compareAndSet(null,lease)) {
            receiver.send(Message.obtain(null,3).apply { this.data=Bundle().apply { putString("token",token) } })
            closeIncoming(data); return@Handler true
        }
        try {
            foreground()
            startup.execute { launch(lease,data) }
        } catch(_:Exception) { failure(lease,"BACKGROUND_RESTRICTED");closeIncoming(data);stop(lease,null) }
        true
    })
    private fun closeIncoming(data:Bundle) {
        for(key in listOf("listener","model","device")) runCatching { data.getParcelable<ParcelFileDescriptor>(key)?.close() }
    }
    override fun onBind(intent:Intent?):IBinder=messenger.binder
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        if(intent?.action==STOP) active.get()?.let { failure(it,"USER_STOP");stop(it,null) }
        return START_NOT_STICKY
    }
    override fun onUnbind(intent:Intent?):Boolean { active.get()?.let { stop(it,null) }; return false }
    override fun onDestroy() { active.get()?.let { stop(it,null) }; super.onDestroy() }

    private fun foreground() {
        val notifications=getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel("runtime","本地编程运行",NotificationManager.IMPORTANCE_LOW))
        val pending=PendingIntent.getService(this,0,Intent(this,RuntimeService::class.java).setAction(STOP),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification=Notification.Builder(this,"runtime").setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Skivu 本地 DSH 正在运行").setContentText("返回 Skivu 继续；关闭运行页面或点击停止即可结束。")
            .setOngoing(true).setOnlyAlertOnce(true).addAction(Notification.Action.Builder(null,"停止",pending).build()).build()
        if(Build.VERSION.SDK_INT>=34) startForeground(41,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(41,notification)
    }

    private fun status(lease:Lease,phase:String,files:Int=0) {
        if(files==0)android.util.Log.i("SkivuRuntime", "startup phase=$phase")
        runCatching { lease.reply.send(Message.obtain(null,5).apply { data=Bundle().apply { putString("token",lease.token);putString("phase",phase);putInt("files",files) } }) }
    }
    private fun failure(lease:Lease,reason:String) {
        if(lease.cancelled)return
        runCatching { lease.reply.send(Message.obtain(null,3).apply { data=Bundle().apply { putString("token",lease.token);putString("reason",reason) } }) }
    }

    private fun launch(lease:Lease,data:Bundle) {
        var pipes:Array<ParcelFileDescriptor>?=null
        try {
            check(native.stopAll())
            status(lease,"unpacking")
            val root=RuntimeInstaller(this).install { count->if(!lease.cancelled)status(lease,"unpacking",count) }
            if(lease.cancelled) return
            val home=File(filesDir,"home").apply { mkdirs() }
            val projects=File(filesDir,"projects").apply { mkdirs() }
            val tmp=File(filesDir,"tmp").apply { mkdirs() }
            val profile=File(home,"profiles/web").apply { mkdirs() }
            val modules=File(profile,"node_modules")
            if(!java.nio.file.Files.exists(modules.toPath(),java.nio.file.LinkOption.NOFOLLOW_LINKS)) android.system.Os.symlink("/opt/dsh/node_modules",modules.absolutePath)
            // Host adapter configuration contains no model key, token, URL or funding choice.
            File(profile,"cordis.patch.yml").writeText("""
- id: agent-default-model
  config:
    provider: skivu-current
    model: selected-in-skivu
- id: permission
  config:
    defaultPreset: danger-full-access
- insert:
    - id: skivu-model
      name: skivu-model-adapter
    - id: skivu-device
      name: skivu-device-tools
""".trimIndent()+"\n")
            val listener=data.getParcelable<ParcelFileDescriptor>("listener") ?: error("listener")
            val model=data.getParcelable<ParcelFileDescriptor>("model") ?: error("model")
            val device=data.getParcelable<ParcelFileDescriptor>("device") ?: error("device")
            val port=data.getInt("port"); require(port in 1..65535)
            pipes=ParcelFileDescriptor.createPipe()
            val lib=File(applicationInfo.nativeLibraryDir)
            status(lease,"launching")
            synchronized(lease.lock) {
                if(lease.cancelled) return
                lease.pid=native.start(listener.fd,model.fd,device.fd,pipes[1].fd,
                    File(lib,"libproot.so").absolutePath,File(lib,"libprootloader.so").absolutePath,
                    root.absolutePath,tmp.absolutePath,home.absolutePath,projects.absolutePath,port.toString(),data.getBoolean("modelCatalog",false))
                check(lease.pid>0)
            }
            pipes[1].close()
            val captured=StringBuilder()
            val expression=Regex("http://127\\.0\\.0\\.1:$port/\\?[^\\s\\u001b]+")
            val stdout=pipes[0]
            Thread {
                try {
                    FileInputStream(stdout.fileDescriptor).bufferedReader().use { reader ->
                        val buffer=CharArray(1024); var ready=false
                        while(true) {
                            val n=reader.read(buffer); if(n<0) break
                            captured.append(buffer,0,n)
                            if(captured.length>16384) captured.delete(0,captured.length-8192)
                            if(!ready) {
                                val url=expression.find(captured)?.value
                                if(url!=null && !lease.cancelled) {
                                    ready=true; lease.ready=true; captured.setLength(0)
                                    android.util.Log.i("SkivuRuntime","startup ready")
                                    lease.reply.send(Message.obtain(null,2).apply { this.data=Bundle().apply { putString("token",lease.token); putString("url",url) } })
                                }
                            }
                        }
                        if(!ready && !lease.cancelled) {
                            // Only native bootstrap/PRoot diagnostics, never engine, model or user output.
                            captured.toString().lineSequence().filter {
                                (it.startsWith("proot error:") || it.startsWith("proot warning:") || it.startsWith("skivu bootstrap execve:")) &&
                                    !Regex("token|auth|https?://|secret|bearer|sk-|key",RegexOption.IGNORE_CASE).containsMatchIn(it)
                            }.take(8).forEach { android.util.Log.w("SkivuRuntime",it.take(300)) }
                        }
                        if((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0 && !lease.cancelled) {
                            val diagnostic=captured.toString().lineSequence().filterNot { it.contains("token",true) || it.contains("auth",true) || it.contains("http",true) }.joinToString("\n").takeLast(16000)
                            diagnostic.lineSequence().forEach { android.util.Log.w("SkivuRuntime","STARTTRACE "+it.take(600)) }
                        }
                    }
                } catch(_:Exception) {} finally { runCatching { stdout.close() } }
            }.apply { name="DSH output"; isDaemon=true; start() }
            Thread {
                while(!lease.cancelled && active.get()===lease) {
                    val exit=synchronized(lease.lock) { if(lease.pid<0) -1 else native.poll(lease.pid) }
                    if(exit!=0) {
                        android.util.Log.w("SkivuRuntime","runtime exit=$exit ready=${lease.ready}")
                        failure(lease,"PROCESS_EXIT");stop(lease,null);break
                    }
                    Thread.sleep(300)
                }
            }.apply { name="DSH monitor"; isDaemon=true; start() }
        } catch(error:Exception) {
            android.util.Log.w("SkivuRuntime","startup exception="+error.javaClass.simpleName)
            if((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0) android.util.Log.w("SkivuRuntime","Runtime startup failed",error)
            failure(lease,"PREPARE_FAILED")
            stop(lease,null)
        } finally {
            closeIncoming(data)
            runCatching { pipes?.get(1)?.close() }
        }
    }
    private fun stop(lease:Lease,reply:Messenger?) {
        synchronized(lease.lock) {
            if(lease.stopFinished) { sendStop(lease,reply,lease.stopResult); return }
            if(reply!=null) lease.stopReplies.add(reply)
            if(lease.stopStarted) return
            lease.stopStarted=true; lease.cancelled=true
        }
        cleanup.execute {
            val stopped=synchronized(lease.lock) { native.stopAll().also { lease.pid=-1 } }
            synchronized(lease.lock) {
                lease.stopResult=stopped; lease.stopFinished=true
                active.compareAndSet(lease,null)
                lease.stopReplies.forEach { sendStop(lease,it,stopped) }; lease.stopReplies.clear()
                handler.post { if(active.get()==null) { stopForeground(STOP_FOREGROUND_REMOVE);stopSelf() } }
            }
        }
    }
    private fun sendStop(lease:Lease,reply:Messenger?,stopped:Boolean) {
        runCatching { reply?.send(Message.obtain(null,4).apply { data=Bundle().apply {
            putString("token",lease.token); putBoolean("stopped",stopped)
        } }) }
    }
}

class NativeRunner {
    companion object { init { System.loadLibrary("runtime") } }
    external fun start(listener:Int,model:Int,device:Int,output:Int,proot:String,loader:String,
        root:String,tmp:String,home:String,projects:String,port:String,catalog:Boolean):Int
    external fun stopAll():Boolean
    external fun poll(pid:Int):Int
}
