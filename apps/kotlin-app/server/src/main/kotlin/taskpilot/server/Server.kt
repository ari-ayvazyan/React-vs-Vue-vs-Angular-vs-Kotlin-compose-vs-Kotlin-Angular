package taskpilot.server

import io.ktor.http.CacheControl
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.CachingOptions
import io.ktor.http.withCharset
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.engine.embeddedServer
import io.ktor.server.plugins.autohead.AutoHeadResponse
import io.ktor.server.plugins.cachingheaders.CachingHeaders
import io.ktor.server.plugins.compression.Compression
import io.ktor.server.plugins.compression.deflate
import io.ktor.server.plugins.compression.gzip
import io.ktor.server.plugins.compression.minimumSize
import io.ktor.server.plugins.conditionalheaders.ConditionalHeaders
import io.ktor.server.request.path
import io.ktor.server.response.header
import io.ktor.server.response.respondBytes
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import java.util.concurrent.ConcurrentHashMap

private const val STATIC_ROOT = "static"

fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 8080
    val host = System.getenv("HOST") ?: "0.0.0.0"
    println("TaskPilot server listening on http://$host:$port")
    embeddedServer(CIO, port = port, host = host, module = Application::taskPilot).start(wait = true)
}

/** Loads a bundled file from the classpath (`/static/...`), rejecting path traversal. */
internal fun loadStatic(path: String): ByteArray? {
    val clean = path.trimStart('/')
    if (clean.isEmpty() || clean.contains("..") || clean.contains('\\')) return null
    val bytes =
        staticCache.getOrPut(clean) {
            Thread
                .currentThread()
                .contextClassLoader
                .getResourceAsStream("$STATIC_ROOT/$clean")
                ?.use { it.readBytes() } ?: missing
        }
    return bytes.takeIf { it !== missing }
}

// The bundle is immutable at runtime, so file bytes (and misses) are cached in memory.
private val missing = ByteArray(0)
private val staticCache = ConcurrentHashMap<String, ByteArray>()

private fun contentTypeFor(path: String): ContentType =
    when (path.substringAfterLast('.', "").lowercase()) {
        "html" -> ContentType.Text.Html.withCharset(Charsets.UTF_8)
        "js" -> ContentType.Text.JavaScript.withCharset(Charsets.UTF_8)
        "css" -> ContentType.Text.CSS.withCharset(Charsets.UTF_8)
        "svg" -> ContentType.Image.SVG
        "json", "map" -> ContentType.Application.Json
        "png" -> ContentType.Image.PNG
        "ico" -> ContentType("image", "x-icon")
        "txt" -> ContentType.Text.Plain.withCharset(Charsets.UTF_8)
        else -> ContentType.Application.OctetStream
    }

fun Application.taskPilot() {
    val indexHtml = loadStatic("index.html") ?: error("index.html missing from classpath – run the web build first")
    install(Compression) {
        gzip { minimumSize(1024) }
        deflate { minimumSize(1024) }
    }
    install(ConditionalHeaders)
    install(AutoHeadResponse)
    install(CachingHeaders) {
        // Asset names are not content-hashed, so let browsers revalidate (cheap thanks to ETags).
        options { _, _ -> CachingOptions(CacheControl.NoCache(null)) }
    }
    routing {
        get("/healthz") { call.respondText("ok") }
        get("/{path...}") {
            val path = call.request.path()
            val bytes = if (path == "/" || path.isEmpty()) null else loadStatic(path)
            when {
                bytes != null -> {
                    call.response.header(HttpHeaders.ETag, "\"${bytes.contentHashCode().toUInt().toString(16)}-${bytes.size}\"")
                    call.respondBytes(bytes, contentTypeFor(path))
                }
                // Asset-looking paths that do not exist are real 404s ...
                path.substringAfterLast('/').contains('.') -> call.respondText("Not found", status = HttpStatusCode.NotFound)
                // ... everything else is a client-side route: serve the SPA shell (deep links like /tasks/abc).
                else -> {
                    call.response.header("X-Content-Type-Options", "nosniff")
                    call.respondBytes(indexHtml, ContentType.Text.Html.withCharset(Charsets.UTF_8))
                }
            }
        }
    }
}
