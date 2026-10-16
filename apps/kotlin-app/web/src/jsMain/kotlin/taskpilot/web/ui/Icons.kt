package taskpilot.web.ui

import androidx.compose.runtime.Composable
import org.jetbrains.compose.web.svg.Path
import org.jetbrains.compose.web.svg.Svg
import org.jetbrains.compose.web.svg.fill

/** Hand-drawn 24px stroke icons (lucide-style paths, drawn inline – no icon library). */
enum class Icon(val paths: List<String>) {
    Dashboard(listOf("M3 3h7v9H3z", "M14 3h7v5h-7z", "M14 12h7v9h-7z", "M3 16h7v5H3z")),
    Tasks(listOf("M9 6h11", "M9 12h11", "M9 18h11", "M4 6l1 1 2-2", "M4 12l1 1 2-2", "M4 18l1 1 2-2")),
    Board(listOf("M3 4h18v16H3z", "M9 4v16", "M15 4v16")),
    Calendar(listOf("M3 5h18v16H3z", "M3 10h18", "M8 3v4", "M16 3v4")),
    Projects(listOf("M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z")),
    Settings(listOf("M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6")),
    Search(listOf("M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M21 21l-4.3-4.3")),
    Plus(listOf("M12 5v14", "M5 12h14")),
    Sun(
        listOf(
            "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
            "M12 2v2",
            "M12 20v2",
            "M4.9 4.9l1.4 1.4",
            "M17.7 17.7l1.4 1.4",
            "M2 12h2",
            "M20 12h2",
            "M4.9 19.1l1.4-1.4",
            "M17.7 6.3l1.4-1.4",
        ),
    ),
    Moon(listOf("M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z")),
    Monitor(listOf("M3 4h18v12H3z", "M8 20h8", "M12 16v4")),
    Menu(listOf("M4 6h16", "M4 12h16", "M4 18h16")),
    Close(listOf("M18 6L6 18", "M6 6l12 12")),
    ChevronLeft(listOf("M15 18l-6-6 6-6")),
    ChevronRight(listOf("M9 18l6-6-6-6")),
    ChevronDown(listOf("M6 9l6 6 6-6")),
    ChevronUp(listOf("M18 15l-6-6-6 6")),
    Check(listOf("M20 6L9 17l-5-5")),
    Trash(listOf("M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6", "M10 11v6", "M14 11v6")),
    Edit(listOf("M12 20h9", "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z")),
    Play(listOf("M6 4l14 8-14 8z")),
    Pause(listOf("M6 4h4v16H6z", "M14 4h4v16h-4z")),
    Reset(listOf("M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5")),
    Timer(listOf("M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M12 10v4l2 2", "M9 2h6")),
    Clock(listOf("M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 6v6l4 2")),
    Flame(listOf("M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7z")),
    Alert(listOf("M12 9v4", "M12 17h.01", "M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z")),
    Keyboard(listOf("M2 6h20v12H2z", "M6 10h.01", "M10 10h.01", "M14 10h.01", "M18 10h.01", "M7 14h10")),
    Undo(listOf("M9 14L4 9l5-5", "M4 9h11a5 5 0 0 1 0 10h-3")),
    Download(listOf("M12 3v12", "M7 10l5 5 5-5", "M5 21h14")),
    Upload(listOf("M12 21V9", "M7 14l5-5 5 5", "M5 3h14")),
    Arrow(listOf("M5 12h14", "M13 6l6 6-6 6")),
    Tag(listOf("M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z", "M7.5 7.5h.01")),
    Repeat(listOf("M17 2l4 4-4 4", "M3 11V9a3 3 0 0 1 3-3h15", "M7 22l-4-4 4-4", "M21 13v2a3 3 0 0 1-3 3H3")),
    Users(
        listOf(
            "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
            "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
            "M22 21v-2a4 4 0 0 0-3-3.9",
            "M16 3.1a4 4 0 0 1 0 7.8",
        ),
    ),
    Lock(listOf("M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4")),
    Activity(listOf("M22 12h-4l-3 9L9 3l-3 9H2")),
    Message(listOf("M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z")),
    Link(listOf("M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7", "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7")),
    Timeline(listOf("M3 6h10", "M7 12h12", "M5 18h8", "M3 3v18")),
    Bookmark(listOf("M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z")),
    More(listOf("M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z")),
    Bell(listOf("M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9", "M13.7 21a2 2 0 0 1-3.4 0")),
    Report(listOf("M3 3v18h18", "M7 15l4-4 3 3 6-6")),
    Collapse(listOf("M3 4h18v16H3z", "M9 4v16", "M15 10l-2 2 2 2")),
}

@Composable
fun IconView(icon: Icon, size: Int = 18, className: String = "icon") {
    Svg(viewBox = "0 0 24 24", attrs = {
        attr("width", size.toString())
        attr("height", size.toString())
        attr("aria-hidden", "true")
        attr("focusable", "false")
        attr("class", className)
        fill("none")
        attr("stroke", "currentColor")
        attr("stroke-width", "2")
        attr("stroke-linecap", "round")
        attr("stroke-linejoin", "round")
    }) {
        icon.paths.forEach { p -> Path(p) }
    }
}
