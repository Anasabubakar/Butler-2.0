plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.anas.butler"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.anas.butler"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    // One fixed key (from CI's ANDROID_DEBUG_KEYSTORE secret), so a new build installs over the old app
    // and keeps its settings. Without it, Gradle uses a throwaway key and you'd have to uninstall first.
    val stableKey = System.getenv("BUTLER_KEYSTORE")?.let { file(it) }?.takeIf { it.exists() }
    signingConfigs {
        if (stableKey != null) {
            create("stable") {
                storeFile = stableKey
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        debug {
            if (stableKey != null) signingConfig = signingConfigs.getByName("stable")
        }
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
