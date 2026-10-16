package taskpilot.web

import kotlinx.browser.document
import kotlinx.browser.localStorage
import kotlinx.browser.window
import org.w3c.dom.HTMLAnchorElement
import org.w3c.dom.url.URL
import org.w3c.files.Blob
import org.w3c.files.BlobPropertyBag
import taskpilot.Clock
import kotlin.js.Date

/** Thin wrappers around browser APIs so the rest of the UI stays declarative. */
object Platform {
    fun clock(): Clock {
        val now = Date()
        return Clock(now.getTime().toLong(), -now.getTimezoneOffset())
    }

    fun nowMs(): Long = Date.now().toLong()

    fun readStorage(key: String): String? =
        try {
            localStorage.getItem(key)
        } catch (e: Throwable) {
            null
        }

    fun writeStorage(key: String, value: String): Boolean =
        try {
            localStorage.setItem(key, value)
            true
        } catch (e: Throwable) {
            false
        }

    fun download(fileName: String, content: String, mime: String = "application/json") {
        val blob = Blob(arrayOf(content), BlobPropertyBag(type = mime))
        val url = URL.createObjectURL(blob)
        val a = document.createElement("a") as HTMLAnchorElement
        a.href = url
        a.download = fileName
        a.style.display = "none"
        document.body?.appendChild(a)
        a.click()
        a.remove()
        window.setTimeout({ URL.revokeObjectURL(url) }, 1000)
    }

    fun prefersDark(): Boolean = window.matchMedia("(prefers-color-scheme: dark)").matches

    fun isTypingTarget(target: org.w3c.dom.events.EventTarget?): Boolean {
        val el = target as? org.w3c.dom.HTMLElement ?: return false
        val tag = el.tagName.lowercase()
        return tag == "input" || tag == "textarea" || tag == "select" || el.isContentEditable
    }

    val isMac: Boolean by lazy {
        window.navigator.platform
            .lowercase()
            .contains("mac")
    }
}
