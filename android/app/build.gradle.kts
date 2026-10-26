plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.anas.butler"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.anas.butler"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
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
    buildFeatures {
        compose = true
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

    // The library screens: native, so they work with no internet.
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    // Pictures, kept on the phone after the first look.
    implementation("io.coil-kt:coil-compose:2.7.0")
}
