package taskpilot.server

import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ServerTest {
    @Test
    fun deepLinksServeTheAppShell() =
        testApplication {
            application { taskPilot() }
            for (path in listOf("/", "/dashboard", "/tasks/abc", "/does/not/exist")) {
                val res = client.get(path)
                assertEquals(HttpStatusCode.OK, res.status, path)
                assertTrue(res.bodyAsText().contains("<div id=\"root\">"), path)
            }
        }

    @Test
    fun servesAssetsAndRejectsMissingOnes() =
        testApplication {
            application { taskPilot() }
            assertEquals(HttpStatusCode.OK, client.get("/app.js").status)
            assertEquals(HttpStatusCode.OK, client.get("/styles.css").status)
            assertEquals(HttpStatusCode.NotFound, client.get("/missing.js").status)
            assertEquals(HttpStatusCode.NotFound, client.get("/../secret.txt").status)
        }
}
