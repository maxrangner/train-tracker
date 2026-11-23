<?php
// Spårat's viewer count (Max, 2026-11-23: "how many are using my app and site. Doesn't have to be exact, but ballpark
// is fine"; our own, no third party). Each open page or app sends "I'm here" every 5 minutes while it is shown:
// a random id that is new each day and a/s (app or site), nothing else (src/count.js). This file writes one line per
// call, "<unix time> <id> <a|s>", into days/<Swedish day>.txt. No address, no cookie, no name is kept.
// The fetcher reads the day files over SFTP and counts (fetcher/viewers.mjs); days/ can't be read from the web
// (days/.htaccess, put there by tools/deploy.mjs). Files older than 8 days are deleted here.
// No secret is in this file: the worst a stranger can do is add made-up visits (a day file is capped at 20 MB).
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); exit; }
$body = file_get_contents('php://input', false, null, 0, 40);
if (!is_string($body) || !preg_match('/^([a-z0-9]{12}) ([as])$/', trim($body), $m)) { http_response_code(400); exit; }
date_default_timezone_set('Europe/Stockholm');
$dir = __DIR__ . '/days';
if (!is_dir($dir) && !@mkdir($dir, 0755)) { http_response_code(500); exit; }
$day = date('Y-m-d');
$file = "$dir/$day.txt";
clearstatcache();
$new = !is_file($file);
if (!$new && filesize($file) > 20000000) { http_response_code(507); exit; }
file_put_contents($file, time() . " {$m[1]} {$m[2]}\n", FILE_APPEND | LOCK_EX);
if ($new) {
  // The first call of a day: day files older than 8 days go.
  foreach (glob("$dir/*.txt") ?: [] as $f) {
    if (preg_match('/(\d{4}-\d\d-\d\d)\.txt$/', $f, $d) && $d[1] < date('Y-m-d', strtotime('-8 days'))) @unlink($f);
  }
}
http_response_code(204);
