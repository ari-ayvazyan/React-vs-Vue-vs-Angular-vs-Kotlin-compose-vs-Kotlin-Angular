package taskpilot

import kotlin.random.Random

/** Random, collision-resistant ids for user-created entities. */
fun newId(prefix: String): String {
    val chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    val body = (1..10).map { chars[Random.nextInt(chars.length)] }.joinToString("")
    return "$prefix-$body"
}
