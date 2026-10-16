plugins {
    alias(libs.plugins.kotlin.jvm)
    application
}

kotlin {
    jvmToolchain(21)
}

application {
    mainClass.set("taskpilot.server.ServerKt")
}

dependencies {
    implementation(libs.ktor.server.core)
    implementation(libs.ktor.server.cio)
    implementation(libs.ktor.server.compression)
    implementation(libs.ktor.server.caching.headers)
    implementation(libs.ktor.server.conditional.headers)
    implementation(libs.ktor.server.auto.head)
    testImplementation(kotlin("test"))
    testImplementation(libs.ktor.server.test.host)
}

// Bundle the production web build into the server's classpath resources under /static.
val webDist = project(":web").layout.buildDirectory.dir("dist/js/productionExecutable")
tasks.named<ProcessResources>("processResources") {
    dependsOn(":web:jsBrowserDistribution")
    from(webDist) { into("static") }
}
