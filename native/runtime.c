#include <jni.h>
#include <unistd.h>
#include <fcntl.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <signal.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <dirent.h>
#include <errno.h>
#include <sys/utsname.h>

JNIEXPORT jint JNICALL Java_org_skivu_dsh_runtime_NativeRunner_start(JNIEnv *env,jobject self,
    jint listener,jint model,jint device,jint output,jstring jp,jstring jl,jstring jr,jstring jt,jstring jh,jstring jw,jstring jport) {
    jstring vals[]={jp,jl,jr,jt,jh,jw,jport}; const char *s[7];
    for(int i=0;i<7;i++)s[i]=(*env)->GetStringUTFChars(env,vals[i],0);
    char *tmpenv,*loaderenv,*homebind,*workbind;
    asprintf(&tmpenv,"PROOT_TMP_DIR=%s",s[3]); asprintf(&loaderenv,"PROOT_LOADER=%s",s[1]);
    asprintf(&homebind,"%s:/root/skivu-home",s[4]); asprintf(&workbind,"%s:/workspace",s[5]);
    struct utsname kernel; int major=0,minor=0;
    if(uname(&kernel)==0)sscanf(kernel.release,"%d.%d",&major,&minor);
    char *order=(major>4||(major==4&&minor>=8))?"PROOT_ASSUME_NEW_SECCOMP=1":"SKIVU_SECCOMP_ORDER=old";
    char *argv[]={(char*)s[0],
#ifdef SKIVU_RUNTIME_TRACE
        "-v","3",
#endif
        "--kill-on-exit","-0","-r",(char*)s[2],"-b","/dev","-b","/proc",
        "-b",homebind,"-b",workbind,"-w","/workspace","/opt/node/bin/node",
        "/opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js","web","--host","127.0.0.1","--port",(char*)s[6],"--no-open",NULL};
    char *environment[]={tmpenv,loaderenv,"PROOT_NO_SECCOMP=1",order,"HOME=/workspace","TMPDIR=/tmp",
        "DSH_HOME=/root/skivu-home","PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin",
        "SKIVU_MODEL_BROKER_FD=4","SKIVU_DEVICE_BROKER_FD=5","ANDROID_ROOT=/system","ANDROID_DATA=/data",NULL};
    pid_t child=fork();
    if(child==0) {
        if(setpgid(0,0)<0)_exit(124);
        int a=fcntl(listener,F_DUPFD_CLOEXEC,10),b=fcntl(model,F_DUPFD_CLOEXEC,10),c=fcntl(device,F_DUPFD_CLOEXEC,10),d=fcntl(output,F_DUPFD_CLOEXEC,10);
        if(a<0||b<0||c<0||d<0||dup2(a,3)<0||dup2(b,4)<0||dup2(c,5)<0||dup2(d,1)<0||dup2(d,2)<0)_exit(120);
#ifdef SKIVU_RUNTIME_TRACE
        char tracepath[4096];snprintf(tracepath,sizeof(tracepath),"%s/trace.log",s[3]);
        int tracefd=open(tracepath,O_WRONLY|O_CREAT|O_TRUNC,0600);
        if(tracefd>=0)dup2(tracefd,2);
#endif
        int nullfd=open("/dev/null",O_RDONLY); if(nullfd<0||dup2(nullfd,0)<0)_exit(121);
        for(int i=3;i<=5;i++) if(fcntl(i,F_SETFD,0)<0)_exit(121);
        for(int i=6;i<65536;i++)close(i);
        execve(s[0],argv,environment); _exit(122);
    }
    for(int i=0;i<7;i++)(*env)->ReleaseStringUTFChars(env,vals[i],s[i]);
    free(tmpenv);free(loaderenv);free(homebind);free(workbind);return child;
}

static int sweep(void) {
    DIR *proc=opendir("/proc"); if(!proc)return -1;
    struct dirent *entry; int found=0; uid_t uid=getuid(); pid_t own=getpid();
    while((entry=readdir(proc))!=NULL) {
        char *end;long pid=strtol(entry->d_name,&end,10);
        if(!*entry->d_name||*end||pid<=1||pid==own)continue;
        char path[80];snprintf(path,sizeof(path),"/proc/%ld",pid);
        struct stat info;if(stat(path,&info)<0||info.st_uid!=uid)continue;
        // This APK has a single service process and no other worker clients.
        // Scan the UID, including setsid/double-fork descendants, never another app.
        if(kill((pid_t)pid,SIGKILL)==0)found++;
    }
    closedir(proc);while(waitpid(-1,NULL,WNOHANG)>0){}return found;
}
JNIEXPORT jboolean JNICALL Java_org_skivu_dsh_runtime_NativeRunner_stopAll(JNIEnv *env,jobject self) {
    int quiet=0;
    for(int attempt=0;attempt<40;attempt++) {
        int count=sweep();if(count<0)return JNI_FALSE;
        if(count==0) {if(++quiet>=2)return JNI_TRUE;} else quiet=0;
        usleep(100000);
    }
    return JNI_FALSE;
}
JNIEXPORT jint JNICALL Java_org_skivu_dsh_runtime_NativeRunner_poll(JNIEnv *env,jobject self,jint pid) {
    if(pid<=0)return -1;int status;pid_t r=waitpid(pid,&status,WNOHANG);return r==0?0:r==pid?1:-1;
}
