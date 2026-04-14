/**
 * Parse the header of a VTopo .tro file and return cave metadata.
 * The file is encoded in Latin-1 (ISO-8859-1).
 *
 * Returns an object with: name, höhle, kataster, datum
 */
function parseTroHeader(troText) {
  const info = {
    cave_id: 0,
    kataster: 0,
    höhle: '',
    name: '',
    datum: ''
  };

  const lines = troText.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    // Trou line: "Trou <name>,<easting>,<northing>,<elevation>,<coord>"
    if (trimmed.startsWith('Trou ')) {
      const afterTrou = trimmed.slice(5); // remove "Trou "
      const commaIdx = afterTrou.indexOf(',');
      const caveName = commaIdx !== -1 ? afterTrou.slice(0, commaIdx).trim() : afterTrou.trim();
      if (caveName) {
        info.name = caveName;
        // Use the first word as the short name (höhle)
        const parts = caveName.split(/\s+/);
        info.höhle = (parts[0] || caveName).replace(/:$/, '');
      }
      continue;
    }

    // Param line: "Param ... Std DD/MM/YYYY M"
    // Only pick the first Param line that has a real date (not --/--/----)
    if (trimmed.startsWith('Param ') && !info.datum) {
      const dateMatch = trimmed.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (dateMatch) {
        const [, dd, mm, yyyy] = dateMatch;
        const day = parseInt(dd, 10);
        const month = parseInt(mm, 10);
        // Basic validation: month must be 1-12, day must be 1-31
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          info.datum = `${yyyy}-${mm}-${dd}`;
        }
      }
    }
  }

  return info;
}

/**
 * Parse a VTopo station label into {gang, punkt}.
 *
 * VTopo uses two notations:
 *   - "series.station"  (Toporobot style): e.g. "1.6"  → {gang:1, punkt:6}
 *   - plain integer:    e.g. "500"         → {gang:0, punkt:500}
 *
 * Returns null for splay markers ("*").
 */
function parseStation(stationStr) {
  const s = String(stationStr).trim();
  if (s === '*') return null;

  const dotIdx = s.indexOf('.');
  if (dotIdx !== -1) {
    const gang  = parseInt(s.slice(0, dotIdx), 10) || 0;
    const punkt = parseInt(s.slice(dotIdx + 1), 10) || 0;
    return { gang, punkt };
  }

  // Plain integer or integer with trailing letters (e.g. "907y") — extract leading digits
  const num = parseInt(s, 10);
  return { gang: 0, punkt: isNaN(num) ? 0 : num };
}

/**
 * Parse a LRUD value; returns 0.0 for unknown ("*") or non-numeric values.
 */
function parseLRUD(val) {
  const f = parseFloat(val);
  return isNaN(f) ? 0.0 : f;
}

function formatNumber(value) {
  return Number(value).toFixed(2);
}

function formatSurveyDate(dateValue) {
  if (!dateValue) return '';
  const match = String(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(dateValue);
  const [, year, month, day] = match;
  return `${month}/${day}/${year}`;
}

function normalizeCaveInfo(caveInfo) {
  return Object.assign({
    cave_id: 0,
    kataster: 0,
    höhle: 'Unknown',
    name: 'Unknown Cave',
    datum: new Date().toISOString().slice(0, 10)
  }, caveInfo);
}

function calculateTargetCoordinates(origin, length, azimuthDegrees, inclinationDegrees) {
  const azimuth = azimuthDegrees * Math.PI / 180;
  const inclination = inclinationDegrees * Math.PI / 180;
  const horizontal = length * Math.cos(inclination);

  return {
    x: origin.x + horizontal * Math.sin(azimuth),
    y: origin.y + horizontal * Math.cos(azimuth),
    z: origin.z + length * Math.sin(inclination)
  };
}

function getDefaultStationLabel(gang, punkt) {
  return gang > 0 ? `${gang}.${punkt}` : String(punkt);
}

function parseSurveyShots(troText) {
  const lines = troText.split(/\r?\n/);
  const shots = [];
  const stationCoords = new Map();

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('[') ||
      trimmed.startsWith('Version') ||
      trimmed.startsWith('Verification') ||
      trimmed.startsWith('Trou') ||
      trimmed.startsWith('Club') ||
      trimmed.startsWith('Entree') ||
      trimmed.startsWith('Toporobot') ||
      trimmed.startsWith('Couleur') ||
      trimmed.startsWith('Param')
    ) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (!isDataLine(parts)) continue;

    const fromStation = parseStation(parts[0]);
    const toStation = parseStation(parts[1]);
    if (!fromStation || !toStation) continue;

    const length = parseFloat(parts[2]);
    const azimuth = parseFloat(parts[3]);
    const inclination = parseFloat(parts[4]);
    const left = parseLRUD(parts[5]);
    const right = parseLRUD(parts[6]);
    const up = parseLRUD(parts[7]);
    const down = parseLRUD(parts[8]);
    const fromKey = `${fromStation.gang}:${fromStation.punkt}`;
    const toKey = `${toStation.gang}:${toStation.punkt}`;
    const origin = stationCoords.get(fromKey) || { x: 0, y: 0, z: 0 };
    const target = calculateTargetCoordinates(origin, length, azimuth, inclination);

    if (!stationCoords.has(fromKey)) {
      stationCoords.set(fromKey, origin);
    }
    if (!stationCoords.has(toKey)) {
      stationCoords.set(toKey, target);
    }

    shots.push({
      fromStation,
      toStation,
      fromRaw: parts[0],
      toRaw: parts[1],
      length,
      azimuth,
      inclination,
      left,
      right,
      up,
      down,
      refX: origin.x,
      refY: origin.y,
      refZ: origin.z,
      x: target.x,
      y: target.y,
      z: target.z
    });
  }

  return shots;
}

/**
 * Returns true only for real survey shots — skips header lines, splay shots
 * (to-station == "*"), and lines that do not have a numeric length field.
 */
function isDataLine(parts) {
  if (parts.length < 9) return false;
  if (isNaN(parseFloat(parts[2]))) return false;
  if (parts[1] === '*') return false; // splay / wall-distance shot
  return true;
}

/**
 * Parse the header of a Survex .svx file and return cave metadata.
 */
function parseSvxHeader(svxText) {
  const info = {
    cave_id: 0,
    kataster: 0,
    höhle: '',
    name: '',
    datum: ''
  };

  const lines = svxText.split(/\r?\n/);
  let foundFirstBegin = false;

  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;

    // Strip inline comment
    const commentIdx = raw.indexOf(';');
    const trimmed = commentIdx !== -1 ? raw.slice(0, commentIdx).trim() : raw;
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();
    const parts = trimmed.split(/\s+/);

    // Cave name from first *begin with a label
    if (!foundFirstBegin && lower.startsWith('*begin')) {
      if (parts.length > 1) {
        const caveName = parts.slice(1).join(' ');
        info.name = caveName;
        info.höhle = parts[1];
        foundFirstBegin = true;
      }
      continue;
    }

    // Cave name from *title
    if (!info.name && lower.startsWith('*title')) {
      const titleMatch = trimmed.match(/\*title\s+"([^"]+)"/i) || trimmed.match(/\*title\s+(.+)/i);
      if (titleMatch) {
        info.name = titleMatch[1].trim();
        if (!info.höhle) {
          info.höhle = info.name.split(/\s+/)[0];
        }
      }
      continue;
    }

    // Date: *date YYYY.MM.DD or YYYY-MM-DD
    if (lower.startsWith('*date') && !info.datum) {
      const dateMatch = trimmed.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
      if (dateMatch) {
        const [, yyyy, mm, dd] = dateMatch;
        info.datum = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      }
    }
  }

  return info;
}

/**
 * Parse survey shots from a Survex .svx file.
 * Returns an array of shot objects in the same format as parseSurveyShots().
 */
function parseSvxShots(svxText) {
  const shots = [];
  const stationCoords = new Map();

  // Series hierarchy tracking
  const seriesStack = [];
  const seriesIds = new Map();
  let nextGangId = 1;

  // Station ID tracking (for non-numeric station names)
  const stationIds = new Map();
  const stationCounters = new Map();

  function getGangId(seriesPath) {
    const key = seriesPath || '__root__';
    if (!seriesIds.has(key)) {
      seriesIds.set(key, nextGangId++);
    }
    return seriesIds.get(key);
  }

  function getPunktId(gang, stationName) {
    // Use integer station names directly as punkt IDs
    const numVal = parseInt(stationName, 10);
    if (!isNaN(numVal) && String(numVal) === stationName.trim()) {
      return numVal;
    }
    // Assign sequential IDs for non-numeric station names
    const key = `${gang}:${stationName}`;
    if (!stationIds.has(key)) {
      const next = stationCounters.get(gang) || 1000;
      stationIds.set(key, next);
      stationCounters.set(gang, next + 1);
    }
    return stationIds.get(key);
  }

  const TAPE_SYNONYMS    = ['tape', 'length', 'distance'];
  const COMPASS_SYNONYMS = ['compass', 'bearing'];
  const CLINO_SYNONYMS   = ['clino', 'gradient', 'angle'];
  const UP_SYNONYMS      = ['up', 'ceiling'];
  const DOWN_SYNONYMS    = ['down', 'floor'];
  const LRUD_QUANTITIES  = ['left', 'right', 'up', 'down', 'ceiling', 'floor', 'lrud'];

  function findFieldIdx(fields, synonyms) {
    return fields.findIndex(f => synonyms.includes(f));
  }

  // Current *data state
  let dataType   = 'normal';
  let dataFields = ['from', 'to', 'tape', 'compass', 'clino'];

  // Unit conversion factors (to metres / degrees)
  let unitsTape    = 1.0;
  let unitsCompass = 1.0;
  let unitsClino   = 1.0;
  let unitsLRUD    = 1.0;

  const lines = svxText.split(/\r?\n/);

  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;

    // Strip inline comment
    const commentIdx = raw.indexOf(';');
    const trimmed = commentIdx !== -1 ? raw.slice(0, commentIdx).trim() : raw;
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();
    const parts = trimmed.split(/\s+/);

    // *begin [series]
    if (lower.startsWith('*begin')) {
      seriesStack.push(parts.length > 1 ? parts[1].toLowerCase() : '');
      continue;
    }

    // *end [series]
    if (lower.startsWith('*end')) {
      if (seriesStack.length > 0) seriesStack.pop();
      continue;
    }

    // *data [type] [fields…]
    if (lower.startsWith('*data')) {
      const args = parts.slice(1).map(p => p.toLowerCase());
      if (args.length === 0 || args[0] === 'default') {
        dataType   = 'normal';
        dataFields = ['from', 'to', 'tape', 'compass', 'clino'];
      } else if (args[0] === 'nosurvey') {
        dataType = 'nosurvey';
      } else if (args[0] === 'normal') {
        dataType   = 'normal';
        dataFields = args.slice(1);
      } else {
        // No explicit type keyword – treat all args as field names
        dataType   = 'normal';
        dataFields = args;
      }
      continue;
    }

    // *units quantity… unit
    if (lower.startsWith('*units')) {
      const args = parts.slice(1).map(p => p.toLowerCase());
      if (args.length >= 2) {
        const unit = args[args.length - 1];
        let factor = 1.0;
        if      (unit === 'feet' || unit === 'foot' || unit === 'ft') factor = 0.3048;
        else if (unit === 'yards' || unit === 'yard' || unit === 'yd') factor = 0.9144;
        else if (unit === 'grads' || unit === 'grad' || unit === 'gradians') factor = 0.9;
        else if (unit === 'minutes' || unit === 'min') factor = 1.0 / 60.0;

        const quantities = args.slice(0, -1);
        for (const q of quantities) {
          if (TAPE_SYNONYMS.includes(q))    unitsTape    = factor;
          else if (COMPASS_SYNONYMS.includes(q)) unitsCompass = factor;
          else if (CLINO_SYNONYMS.includes(q))   unitsClino   = factor;
          else if (LRUD_QUANTITIES.includes(q))  unitsLRUD    = factor;
        }
      }
      continue;
    }

    // Skip all other commands
    if (trimmed.startsWith('*')) continue;

    // Skip nosurvey blocks
    if (dataType === 'nosurvey') continue;

    // Data line
    if (parts.length < 3) continue;

    const fromIdx    = dataFields.indexOf('from');
    const toIdx      = dataFields.indexOf('to');
    const tapeIdx    = findFieldIdx(dataFields, TAPE_SYNONYMS);
    const compassIdx = findFieldIdx(dataFields, COMPASS_SYNONYMS);
    const clinoIdx   = findFieldIdx(dataFields, CLINO_SYNONYMS);
    const leftIdx    = dataFields.indexOf('left');
    const rightIdx   = dataFields.indexOf('right');
    const upIdx      = findFieldIdx(dataFields, UP_SYNONYMS);
    const downIdx    = findFieldIdx(dataFields, DOWN_SYNONYMS);

    if (fromIdx === -1 || toIdx === -1 || tapeIdx === -1) continue;
    if (parts.length <= Math.max(fromIdx, toIdx, tapeIdx)) continue;

    const fromName = parts[fromIdx];
    const toName   = parts[toIdx];

    // Skip splays (to-station is '-' or '.')
    if (!toName || toName === '-' || toName === '.') continue;
    if (!fromName || fromName === '-') continue;

    const tapeRaw = parseFloat(parts[tapeIdx]);
    if (isNaN(tapeRaw) || tapeRaw < 0) continue;
    const tape = tapeRaw * unitsTape;

    const compassVal = compassIdx !== -1 && parts[compassIdx] && parts[compassIdx] !== '-'
      ? parseFloat(parts[compassIdx]) : 0;
    const compass = isNaN(compassVal) ? 0 : compassVal * unitsCompass;

    const clinoVal = clinoIdx !== -1 && parts[clinoIdx] && parts[clinoIdx] !== '-'
      ? parseFloat(parts[clinoIdx]) : 0;
    const clino = isNaN(clinoVal) ? 0 : clinoVal * unitsClino;

    const left  = leftIdx  !== -1 && parts[leftIdx]  ? parseLRUD(parts[leftIdx])  * unitsLRUD : 0;
    const right = rightIdx !== -1 && parts[rightIdx] ? parseLRUD(parts[rightIdx]) * unitsLRUD : 0;
    const up    = upIdx    !== -1 && parts[upIdx]    ? parseLRUD(parts[upIdx])    * unitsLRUD : 0;
    const down  = downIdx  !== -1 && parts[downIdx]  ? parseLRUD(parts[downIdx])  * unitsLRUD : 0;

    const seriesPath = seriesStack.join('.');
    const gang = getGangId(seriesPath);
    const fromStation = { gang, punkt: getPunktId(gang, fromName) };
    const toStation   = { gang, punkt: getPunktId(gang, toName) };

    const fromKey = `${gang}:${fromName}`;
    const toKey   = `${gang}:${toName}`;
    const origin  = stationCoords.get(fromKey) || { x: 0, y: 0, z: 0 };
    const target  = calculateTargetCoordinates(origin, tape, compass, clino);

    if (!stationCoords.has(fromKey)) stationCoords.set(fromKey, origin);
    if (!stationCoords.has(toKey))   stationCoords.set(toKey, target);

    shots.push({
      fromStation,
      toStation,
      fromRaw: fromName,
      toRaw: toName,
      length: tape,
      azimuth: compass,
      inclination: clino,
      left, right, up, down,
      refX: origin.x,
      refY: origin.y,
      refZ: origin.z,
      x: target.x,
      y: target.y,
      z: target.z
    });
  }

  return shots;
}

/**
 * Build a CaveRenderPro XML string from a pre-parsed shots array.
 */
function buildCaveRenderXML(shots, caveInfo) {
  caveInfo = normalizeCaveInfo(caveInfo);
  let xmlLines = '';
  let id = 0;

  for (const shot of shots) {
    const fromStation = shot.fromStation;
    const toStation = shot.toStation;

    xmlLines += `
  <line>
    <cave_id>${caveInfo.cave_id}</cave_id>
    <id>${id}</id>
    <status></status>
    <kataster>${caveInfo.kataster}</kataster>
    <höhle>${escapeXml(caveInfo.höhle)}</höhle>
    <refGang>${fromStation.gang}</refGang>
    <refPunkt>${fromStation.punkt}</refPunkt>
    <gang>${toStation.gang}</gang>
    <punkt>${toStation.punkt}</punkt>
    <start>0.0</start>
    <ende>0.0</ende>
    <tiefe>0.0</tiefe>
    <refTiefe>0.0</refTiefe>
    <länge>${shot.length}</länge>
    <azimut>${shot.azimuth}</azimut>
    <neigung>${shot.inclination}</neigung>
    <querschnitt>0</querschnitt>
    <links>${shot.left}</links>
    <rechts>${shot.right}</rechts>
    <oben>${shot.up}</oben>
    <unten>${shot.down}</unten>
    <gerät>4</gerät>
    <richtung>1.0</richtung>
    <gewicht>0.0</gewicht>
    <ring>0</ring>
    <farbe>4</farbe>
    <ebene>1</ebene>
    <datum>${escapeXml(caveInfo.datum)}</datum>
    <vermesser>0</vermesser>
    <bezeichnung></bezeichnung>
    <info></info>
    <material></material>
    <maßnahmen></maßnahmen>
    <bemerkung></bemerkung>
    <refHöhle></refHöhle>
    <refX>${shot.refX}</refX>
    <refY>${shot.refY}</refY>
    <refZ>${shot.refZ}</refZ>
    <x>${shot.x}</x>
    <y>${shot.y}</y>
    <z>${shot.z}</z>
    <profil>0</profil>
    <profilX>0.0</profilX>
    <profilY>0.0</profilY>
    <linked>VORWÄRTS</linked>
  </line>`;
    id++;
  }

  const xmlHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<CaveRenderPro>
  <version>CaveRenderPro 12.2.0, \u00a9 2015 - 2025 Jochen Hartig, www.caverender.de</version>
  <cave>
    <cave_id>${caveInfo.cave_id}</cave_id>
    <kataster>${caveInfo.kataster}</kataster>
    <höhle>${escapeXml(caveInfo.höhle)}</höhle>
    <name>${escapeXml(caveInfo.name)}</name>
    <datum>${escapeXml(caveInfo.datum)}</datum>
  </cave>
`;

  return xmlHeader + xmlLines + '\n</CaveRenderPro>';
}

/**
 * Build a CaveRenderPro survey-data TXT string from a pre-parsed shots array.
 */
function buildCaveRenderSurveyText(shots, caveInfo) {
  caveInfo = normalizeCaveInfo(caveInfo);
  const surveyDate = formatSurveyDate(caveInfo.datum);
  const caveKey = caveInfo.höhle || caveInfo.name;
  const rows = [
    [
      'Cave', 'RefPassage', 'RefStation', 'Passage', 'Station', 'Start', 'End', 'Depth',
      'Length', 'Azimuth', 'Inclination', 'LRUDs', 'Left', 'Right', 'Up', 'Down',
      'ProfileX', 'ProfileY', 'Profile', 'Instrument', 'Direction', 'Weight', 'Loop',
      'Colour', 'Level', 'Date', 'Surveyor', 'Title', 'Info', 'Material', 'Tasks',
      'Comment', 'RefCave', 'RefX', 'RefY', 'RefZ', 'X', 'Y', 'Z', 'State'
    ].join('\t')
  ];

  for (const shot of shots) {
    const title = shot.fromStation.gang === 0 && shot.fromStation.punkt === 0 && shot.toStation.gang === 0 && shot.toStation.punkt === 0
      ? caveInfo.name
      : '';

    rows.push([
      caveKey,
      shot.fromStation.gang,
      shot.fromStation.punkt,
      shot.toStation.gang,
      shot.toStation.punkt,
      0,
      0,
      '0.00',
      formatNumber(shot.length),
      String(shot.azimuth),
      String(shot.inclination),
      0,
      formatNumber(shot.left),
      formatNumber(shot.right),
      formatNumber(shot.up),
      formatNumber(shot.down),
      '0.00',
      '0.00',
      0,
      4,
      1,
      0,
      0,
      4,
      1,
      surveyDate,
      0,
      title,
      '',
      '',
      '',
      '',
      '',
      formatNumber(shot.refX),
      formatNumber(shot.refY),
      formatNumber(shot.refZ),
      formatNumber(shot.x),
      formatNumber(shot.y),
      formatNumber(shot.z),
      ''
    ].join('\t'));
  }

  return rows.join('\n');
}

/**
 * Convert VTopo .tro text to CaveRenderPro XML string.
 */
function troToCaveRenderXML(troText, caveInfo) {
  return buildCaveRenderXML(parseSurveyShots(troText), caveInfo);
}

function troToCaveRenderSurveyText(troText, caveInfo) {
  return buildCaveRenderSurveyText(parseSurveyShots(troText), caveInfo);
}

/**
 * Convert Survex .svx text to CaveRenderPro XML string.
 */
function svxToCaveRenderXML(svxText, caveInfo) {
  return buildCaveRenderXML(parseSvxShots(svxText), caveInfo);
}

/**
 * Convert Survex .svx text to CaveRenderPro survey-data TXT string.
 */
function svxToCaveRenderSurveyText(svxText, caveInfo) {
  return buildCaveRenderSurveyText(parseSvxShots(svxText), caveInfo);
}

/** Escape special XML characters. */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Module-level storage for the loaded file. */
let currentFileText = null;
let currentFileType = null; // 'tro' or 'svx'

function getSelectedExportFormat() {
  return document.getElementById('exportFormat').value;
}

function onExportFormatChanged() {
  const format = getSelectedExportFormat();
  const convertBtn = document.getElementById('convertBtn');
  const downloadLink = document.getElementById('downloadLink');

  if (format === 'survey') {
    convertBtn.textContent = 'Convert to CaveRender survey data TXT';
    if (downloadLink.style.display !== 'none') {
      downloadLink.textContent = 'Download TXT';
    }
    return;
  }

  convertBtn.textContent = 'Convert to CaveRender project XML';
  if (downloadLink.style.display !== 'none') {
    downloadLink.textContent = 'Download XML';
  }
}

/** Show a status message. */
function showStatus(message, type) {
  const el = document.getElementById('statusMessage');
  el.textContent = message;
  el.className = 'status ' + type;
}

/** Called when the user selects a file. Reads the header and pre-fills the form. */
function onFileSelected(input) {
  const file = input.files[0];
  if (!file) return;

  const isSvx = file.name.toLowerCase().endsWith('.svx');
  currentFileType = isSvx ? 'svx' : 'tro';
  currentFileText = null; // reset while loading
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('downloadLink').style.display = 'none';
  showStatus('Reading file…', 'info');

  const reader = new FileReader();
  reader.onload = function(e) {
    const fileText = e.target.result;

    // Count real survey shots
    let dataLines;
    if (isSvx) {
      dataLines = parseSvxShots(fileText).length;
    } else {
      const lines = fileText.split(/\r?\n/);
      dataLines = 0;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || /^[A-Za-z\[*]/.test(trimmed)) continue;
        const parts = trimmed.split(/\s+/);
        if (isDataLine(parts)) dataLines++;
      }
    }

    // Parse header info
    const info = isSvx ? parseSvxHeader(fileText) : parseTroHeader(fileText);

    // Pre-fill form fields
    document.getElementById('caveName').value    = info.name    || '';
    document.getElementById('caveHöhle').value   = info.höhle  || '';
    document.getElementById('caveKataster').value = info.kataster || 0;
    document.getElementById('caveDate').value    = info.datum   || '';

    // Update preview
    document.getElementById('preview').innerHTML =
      `<strong>File:</strong> ${escapeXml(file.name)}<br>` +
      `<strong>Survey shots detected:</strong> ${dataLines}<br>` +
      (info.name  ? `<strong>Cave name (from header):</strong> ${escapeXml(info.name)}<br>`  : '') +
      (info.datum ? `<strong>Date (from header):</strong> ${escapeXml(info.datum)}<br>` : '');

    // Show steps 2 and 3
    document.getElementById('step2').style.display = '';
    document.getElementById('step3').style.display = '';

    // Store text for conversion
    currentFileText = fileText;

    showStatus('File loaded — ' + dataLines + ' survey shots found.', 'success');
  };

  // SVX files are UTF-8; TRO files use Latin-1 (ISO-8859-1)
  reader.readAsText(file, isSvx ? 'utf-8' : 'iso-8859-1');
}

/** Called when the user clicks "Convert". */
function convertFile() {
  const fileInput = document.getElementById('troFile');
  if (!fileInput.files[0] || !currentFileText) {
    return showStatus('Please select a .tro or .svx file first.', 'error');
  }

  const caveInfo = {
    cave_id: 0,
    kataster: parseInt(document.getElementById('caveKataster').value, 10) || 0,
    höhle:    document.getElementById('caveHöhle').value  || 'Unknown',
    name:     document.getElementById('caveName').value   || 'Unknown Cave',
    datum:    document.getElementById('caveDate').value   || new Date().toISOString().slice(0, 10)
  };
  const exportFormat = getSelectedExportFormat();
  let content;
  if (currentFileType === 'svx') {
    content = exportFormat === 'survey'
      ? svxToCaveRenderSurveyText(currentFileText, caveInfo)
      : svxToCaveRenderXML(currentFileText, caveInfo);
  } else {
    content = exportFormat === 'survey'
      ? troToCaveRenderSurveyText(currentFileText, caveInfo)
      : troToCaveRenderXML(currentFileText, caveInfo);
  }
  const mimeType = exportFormat === 'survey'
    ? 'text/tab-separated-values;charset=utf-8'
    : 'application/xml;charset=utf-8';

  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);

  const link = document.getElementById('downloadLink');
  // Revoke previous object URL if any
  if (link.href && link.href.startsWith('blob:')) {
    URL.revokeObjectURL(link.href);
  }
  link.href = url;
  const inputName = fileInput.files[0].name.replace(/\.(tro|svx)$/i, '');
  link.download = exportFormat === 'survey'
    ? inputName + '_caverender_survey.txt'
    : inputName + '_caverender.xml';
  link.style.display = 'inline-block';
  link.textContent = exportFormat === 'survey' ? 'Download TXT' : 'Download XML';

  showStatus(
    exportFormat === 'survey'
      ? 'Conversion complete. Download the CaveRender survey-data TXT file.'
      : 'Conversion complete. Download the CaveRender project XML file.',
    'success'
  );
}