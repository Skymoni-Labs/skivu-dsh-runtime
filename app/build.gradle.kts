plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "org.skivu.dsh.runtime"
    compileSdk = 36
    defaultConfig {
        applicationId = "org.skivu.dsh.runtime"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        ndk { abiFilters += (providers.gradleProperty("runtimeAbi").orNull ?: "arm64-v8a") }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    packaging { jniLibs { useLegacyPackaging = true } }
    androidResources { noCompress += "bin" }
    sourceSets["main"].assets.srcDir("runtime-assets/" + (providers.gradleProperty("runtimeAbi").orNull ?: "arm64-v8a"))
    // Preserve Skivu's established installation signer. No signing material is
    // stored in this repository; release operators verify the certificate.
    buildTypes { release { isMinifyEnabled = false; signingConfig = signingConfigs.getByName("debug") } }
}
