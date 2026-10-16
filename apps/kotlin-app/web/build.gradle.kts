plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.compose)
}

kotlin {
    js(IR) {
        browser {
            commonWebpackConfig {
                outputFileName = "app.js"
            }
        }
        binaries.executable()
    }
    sourceSets {
        all {
            languageSettings.optIn("org.jetbrains.compose.web.ExperimentalComposeWebSvgApi")
            languageSettings.optIn("org.jetbrains.compose.web.ExperimentalComposeWebApi")
        }
        jsMain.dependencies {
            implementation(project(":shared"))
            implementation(libs.compose.runtime)
            implementation(libs.compose.html.core)
            implementation(libs.compose.html.svg)
            implementation(libs.coroutines.core)
        }
    }
}
