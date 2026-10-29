# Skivu 手机 DSH

独立 Android 运行组件和入口插件，把真实 DeepSeek Harness 放到 Skivu 工作区。
DSH 0.2.1-rc.2、Node 24.18.1 和 Ubuntu 基础命令行在手机本地运行，可以写文件、
运行代码并保存项目和会话。页面与业务不内置到 Skivu 宿主。

## 安装

1. 安装 Skivu 0.2.44 或更新版，登录账号并选择支持工具调用的 chat 模型。
2. 从本项目 Release 安装与手机匹配的运行组件 APK：通常选 `arm64-v8a`，模拟器选 `x86_64`。
3. 在插件市场安装并启用「手机 DSH」，从右侧工作区打开，确认本次本地代码执行。
4. 选择或新建项目文件夹。模型请求在 Skivu 确认后使用当前账号模型和额度。

需要 Android 8.0+ 与 64 位 CPU。首次准备会解压运行环境，请留足存储空间。
项目在 `/workspace`，DSH 存档在 `/root/skivu-home`，均存放于组件自己的应用私有目录。
关闭页面停止运行，重开保留项目；卸载组件会删除数据，请自行备份。

## 能力边界

- 当前支持文字、结构化工具调用、本地文件、Shell 和已安装的 Node 程序。
- 组件没有 INTERNET 权限，不能直接联网安装 npm 包、git clone 或访问网站。
  模型调用通过宿主授权代理；不是给组件发放账号或模型密钥。
- Android 操作需另装设备伴侣并按既有流程授权；用户可以拒绝或停止。
  本项目不自动开启无障碍、ADB、Root 或任何系统权限。
- PRoot 负责 Linux 路径/ABI 兼容，不是安全沙箱。安全边界是独立 Android UID、
  无网络权限、签名服务权限以及宿主逐次授权。确认运行即允许代码修改组件内所有运行文件。
- 32 位 ARM、Responses 协议、多模态和任意宿主私有数据不在此版本开放。
  设备、WebView 和厂商后台限制可能影响兼容性；已有的 x86_64 模拟器验收不能替代所有真机测试。

宿主通用协议见 [local-runtime.md](https://github.com/skyjjgw/skivu/blob/main/docs/local-runtime.md)。
DeepSeek Harness 仍为上游预览版本，Skivu 不冒充其官方 Android 产品。

## 构建

源码许可分别保留在各目录。根目录 GPL-3.0-only 适用于 Skivu 自有代码。
第三方许可证与对应源码获取见 `THIRD-PARTY.md` 和 `provenance/`。

Linux/WSL 使用 Python 3.11+、Node 24.18.1、NDK r29 beta4、make 构建：

```sh
export ANDROID_NDK_HOME=/absolute/path/to/android-ndk-r29-beta4
bash tools/build-native.sh x86_64 /new/absolute/build-x64
# build_runtime.py --help: 输入经过 SHA-256 核验的 Ubuntu/Node 上游包和 npm lock
# 为另一 ABI 重复；输出 app/runtime-assets/<ABI>/runtime.bin + runtime.json
```

Android 使用 JDK 17–23、Gradle 8.13、Android SDK 36：
`gradle -PruntimeAbi=x86_64 assembleRelease`，或 `arm64-v8a`。
签名材料不在源码中。发行证书必须为
`39b262ea602a2c91dc914a7f7ba2dc86e6640e1ad11ca1f07ff61a076b435523`；
复用 Skivu 既有发行签名以兼容 signature 权限，不应使用新生成的本机调试证书冒充正式包。

`plugin/` 是独立入口源码，`packages/` 是可安装插件包。插件市场只收录元数据。
