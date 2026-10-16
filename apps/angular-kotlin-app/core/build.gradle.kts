plugins {
    kotlin("multiplatform") version "2.2.20"
    id("org.jlleitschuh.gradle.ktlint") version "13.1.0"
}

group = "dev.taskpilot"
version = "1.0.0"

kotlin {
    js(IR) {
        outputModuleName.set("taskpilot-core")
        useEsModules()
        nodejs {
            testTask {
                useMocha { timeout = "20s" }
            }
        }
        binaries.library()
        generateTypeScriptDefinitions()
        compilerOptions {
            target.set("es2015")
        }
    }
    sourceSets {
        jsTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}

ktlint {
    version.set("1.7.1")
}

/**
 * Copies the compiled ES-module library (plus .d.mts typings) into the Angular source tree,
 * where it is imported as `@taskpilot/core`.
 */
val syncToAngular by tasks.registering(Sync::class) {
    dependsOn("jsNodeProductionLibraryDistribution")
    from(layout.buildDirectory.dir("dist/js/productionLibrary")) {
        include("*.mjs", "*.d.mts", "package.json")
    }
    into(rootDir.resolve("../src/generated/core"))
}

tasks.register("buildForAngular") {
    group = "build"
    description = "Compiles the Kotlin/JS library and syncs it into the Angular app."
    dependsOn(syncToAngular)
}
