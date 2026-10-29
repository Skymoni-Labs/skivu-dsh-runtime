package org.skivu.dsh.runtime

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.content.pm.PackageManager
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ScrollView

/** Visible user interaction for systems which block cross-app service startup.
 * Model/device authority stays in the host; Android controls system permissions.
 */
class ActivationActivity : Activity() {
    private fun finishActivation() { setResult(RESULT_OK);finish() }
    override fun onRequestPermissionsResult(requestCode:Int,permissions:Array<out String>,grantResults:IntArray) {
        super.onRequestPermissionsResult(requestCode,permissions,grantResults)
        if(requestCode==41)finishActivation()
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val padding = (24 * resources.displayMetrics.density).toInt()
        val content=LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding * 2, padding, padding)
            addView(TextView(this@ActivationActivity).apply {
                text = "启用本地 DSH 组件"
                textSize = 24f
            })
            addView(TextView(this@ActivationActivity).apply {
                text = "组件已安装，从 Skivu 内打开和使用，不增加桌面图标。\n\n如果首次启动被拦截，请允许 Skivu 关联启动本组件。\n\n如果一直停在准备中，打开下方系统设置，在耗电管理中允许后台运行；OPPO / ColorOS 请选“完全允许后台行为”。返回这里后继续。无需开启 USB 调试。"
                textSize = 16f
                setPadding(0, padding, 0, padding)
            })
            addView(Button(this@ActivationActivity).apply {
                text = "启用并返回 Skivu"
                setOnClickListener {
                    if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)
                        requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),41)
                    else finishActivation()
                }
            })
            addView(Button(this@ActivationActivity).apply {
                text = "设置后台运行权限"
                setOnClickListener {
                    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                }
            })
        }
        setContentView(ScrollView(this).apply { addView(content) })
    }
}
