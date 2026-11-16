<?php
// Spårat's answers to taps, on one.com (public-plan step 2): a train's route, a station's board, a station's messages,
// the trains with a number. The page sends only the kind and its values (src/trafikverket.js setTapAsker); this asks
// Trafikverket the very same question the page used to ask itself (same XML) and keeps the answer 30 s, so a train or a
// station is asked at most once per 30 s however many people tap it. Only these four kinds, with checked values:
// it can't be used as an open door to Trafikverket.
// Every kept answer has a new name per 30 s (one.com, measured 2026-11-15: a file replaced under the same name was
// sometimes served minutes old; a new name never). The key is in secret.php next to this file (not in git; the web
// can't read it: .htaccess). Answer: Trafikverket's RESULT as JSON, as src/trafikverket.js ask() returns it.

const KEEP_S = 30;            // an answer is reused this long
const BUDGET_PER_MIN = 120;   // new questions to Trafikverket a minute at most (taps; far under its 100 a second)

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

function fail(int $code, string $why) {
  http_response_code($code);
  header('Cache-Control: no-store');
  echo json_encode(['error' => $why]);
  exit;
}
function param(string $name, string $pattern) {
  $v = $_GET[$name] ?? '';
  if (!is_string($v) || !preg_match($pattern, $v)) fail(400, "bad $name");
  return $v;
}
$x = fn(string $s) => htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
$inc = fn(array $fields) => implode('', array_map(fn($f) => "<INCLUDE>$f</INCLUDE>", $fields));
$iso = fn(int $t) => gmdate('Y-m-d\TH:i:s.000\Z', $t);

$kind = $_GET['q'] ?? '';
$slot = intdiv(time(), KEEP_S);
$at = $slot * KEEP_S;   // "now" for the questions that need it: the same for everyone in this 30 s
$TA = '<QUERY objecttype="TrainAnnouncement" namespace="rail.trafficinfo" schemaversion="1.9"';

switch ($kind) {
  case 'route':   // src/trafikverket.js fetchRoute / routeQuery: by the public number (the whole trip) or the internal one
    $by = param('by', '/^(number|train)$/');
    $value = param('value', '/^\d{1,6}$/');
    $date = param('date', '/^\d{4}-\d{2}-\d{2}$/');
    $params = [$by, $value, $date];
    $field = $by === 'number' ? 'AdvertisedTrainIdent' : 'OperationalTrainNumber';
    $xml = "$TA orderby=\"AdvertisedTimeAtLocation\"><FILTER><EQ name=\"$field\" value=\"{$x($value)}\"/>" .
      "<EQ name=\"ScheduledDepartureDateTime\" value=\"{$x($date)}\"/></FILTER>" .
      $inc(['OperationalTrainNumber', 'LocationSignature', 'ActivityType', 'Advertised', 'AdvertisedTimeAtLocation',
        'EstimatedTimeAtLocation', 'TimeAtLocation', 'Canceled', 'Deleted', 'TrackAtLocation', 'FromLocation', 'ToLocation',
        'ProductInformation', 'Deviation', 'OtherInformation', 'Booking', 'Service', 'TrainComposition']) . '</QUERY>';
    break;
  case 'board':   // fetchBoard
    $sig = param('sig', '/^[\p{L}0-9 ]{1,8}$/u');
    $act = param('act', '/^(Avgang|Ankomst)$/');
    $n = (int) param('n', '/^([1-9]|[12][0-9]|30)$/');
    $params = [$sig, $act, $n];
    $xml = "$TA orderby=\"AdvertisedTimeAtLocation\" limit=\"" . ($n * 4) . "\"><FILTER><EQ name=\"LocationSignature\" value=\"{$x($sig)}\"/>" .
      "<EQ name=\"ActivityType\" value=\"{$x($act)}\"/><EQ name=\"Advertised\" value=\"true\"/><EQ name=\"Deleted\" value=\"false\"/>" .
      "<GT name=\"AdvertisedTimeAtLocation\" value=\"{$iso($at - 90 * 60)}\"/></FILTER>" .
      $inc(['AdvertisedTrainIdent', 'OperationalTrainNumber', 'ScheduledDepartureDateTime', 'AdvertisedTimeAtLocation',
        'EstimatedTimeAtLocation', 'TimeAtLocation', 'TrackAtLocation', 'Canceled', 'ProductInformation', 'FromLocation',
        'ToLocation']) . '</QUERY>';
    break;
  case 'messages':   // fetchStationMessages
    $sig = param('sig', '/^[\p{L}0-9 ]{1,8}$/u');
    $params = [$sig];
    $xml = '<QUERY objecttype="TrainStationMessage" namespace="rail.trafficinfo" schemaversion="1">' .
      "<FILTER><EQ name=\"LocationCode\" value=\"{$x($sig)}\"/><EQ name=\"MediaType\" value=\"Monitor\"/>" .
      "<LT name=\"StartDateTime\" value=\"{$iso($at)}\"/><GT name=\"EndDateTime\" value=\"{$iso($at)}\"/></FILTER>" .
      $inc(['FreeText', 'EndDateTime', 'Status']) . '</QUERY>';
    break;
  case 'train':   // fetchTrainsByNumber
    $number = param('number', '/^\d{1,6}$/');
    $day = param('day', '/^\d{4}-\d{2}-\d{2}$/');
    $params = [$number, $day];
    $xml = "$TA limit=\"200\"><FILTER><EQ name=\"AdvertisedTrainIdent\" value=\"{$x($number)}\"/>" .
      "<EQ name=\"ScheduledDepartureDateTime\" value=\"{$x($day)}\"/></FILTER>" .
      $inc(['AdvertisedTrainIdent', 'OperationalTrainNumber', 'ScheduledDepartureDateTime', 'FromLocation', 'ToLocation',
        'ProductInformation']) . '</QUERY>';
    break;
  default:
    fail(400, 'unknown question');
}

$dir = __DIR__ . '/cache';
if (!is_dir($dir)) @mkdir($dir, 0755);
$file = "$dir/$kind-" . md5(json_encode($params)) . "-$slot.json";
if (is_file($file)) {
  header('Cache-Control: public, max-age=15');
  header('X-Sparat-Cache: hit');
  readfile($file);
  exit;
}

// A new question: within the budget, else "busy" (the page tries again later).
$budget = "$dir/budget-" . intdiv(time(), 60);
$used = (int) @file_get_contents($budget);
if ($used >= BUDGET_PER_MIN) fail(503, 'busy');
@file_put_contents($budget, (string) ($used + 1));

$key = require __DIR__ . '/secret.php';
$c = curl_init('https://api.trafikinfo.trafikverket.se/v2/data.json');
curl_setopt_array($c, [
  CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_CONNECTTIMEOUT => 10,
  CURLOPT_HTTPHEADER => ['Content-Type: text/xml'],
  CURLOPT_POSTFIELDS => "<REQUEST><LOGIN authenticationkey=\"{$x($key)}\"/>$xml</REQUEST>",
]);
$body = curl_exec($c);
$status = curl_getinfo($c, CURLINFO_HTTP_CODE);
if ($body === false) fail(502, 'no answer from Trafikverket');
if ($status === 429) fail(503, 'busy');
if ($status !== 200) fail(502, "Trafikverket answered $status");
$result = json_decode($body, true)['RESPONSE']['RESULT'][0] ?? null;
if (!is_array($result)) fail(502, 'unreadable answer');
if (isset($result['ERROR'])) fail(502, 'Trafikverket: ' . ($result['ERROR']['MESSAGE'] ?? 'error'));

$out = json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$tmp = "$file." . getmypid() . '.tmp';
if (@file_put_contents($tmp, $out) !== false) @rename($tmp, $file);   // a new name: never half read, never stale

// Now and then, let go of old answers and counters (older than 10 minutes).
if (mt_rand(1, 50) === 1) foreach (glob("$dir/*") as $f) if (filemtime($f) < time() - 600) @unlink($f);

header('Cache-Control: public, max-age=15');
header('X-Sparat-Cache: miss');
echo $out;
