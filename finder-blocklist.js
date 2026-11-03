/* finder-blocklist.js (SITE integration, user 2026-11-03: optional "Found by" name). A small list of names the site
 * refuses as a finder (common slurs and profanity). site-finder.js and the stand-in relay check (site12/v3_check.py,
 * which reads this file) match it the same way on the folded name (NFKD, accents removed, lower case, digits read as
 * letters 0=o 1=i 3=e 4=a 5=s 7=t 8=b 9=g):
 *   anywhere: refused when the name with only its letters left contains the entry ("xFUCKx", "f.u.c.k");
 *   words:    refused when a word of the name, or the whole name with only its letters left, is the entry or the
 *             entry + "s" (so "Cassandra" or "Dickens" stay fine).
 * Keep the entries lower case, letters only. The relay and the Action keep their own copy (FINDER_BLOCK). */
globalThis.DV_FINDER_BLOCK = {
  anywhere: ["fuck", "nigger", "nigga", "faggot", "whore", "retard", "rapist", "hitler", "molest", "pedophil", "paedophil",
    "cunt", "motherf", "bullshit", "dickhead", "cocksuck", "jizz", "kkk", "heilhit", "siegheil", "gaschamber", "killyourself"],
  words: ["shit", "ass", "arse", "asshole", "bitch", "slut", "fag", "cum", "kys", "cock", "dick", "twat", "spic", "chink",
    "kike", "rape", "porn", "nazi", "wank", "wanker", "tranny", "pussy", "penis", "vagina", "dildo", "heil", "pedo", "paedo",
    "bastard", "prick", "sex", "anal", "boob", "boobs", "tits", "nsfw", "admin", "moderator", "hellogames"],
};
