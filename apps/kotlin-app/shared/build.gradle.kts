plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(21)
    jvm()
    js(IR) {
        // Consumed by the browser app; unit tests run under Node (no headless Chrome needed).
        browser {
            testTask { enabled = false }
        }
        nodejs()
    }
    sourceSets {
        commonMain.dependencies {
            api(libs.serialization.json)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}
