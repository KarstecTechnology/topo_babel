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
        info.höhle = parts[0] || caveName;
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
 * Convert VTopo .tro text to CaveRenderPro XML string.
 */
function troToCaveRenderXML(troText, caveInfo) {
  caveInfo = Object.assign({
    cave_id: 0,
    kataster: 0,
    höhle: 'Unknown',
    name: 'Unknown Cave',
    datum: new Date().toISOString().slice(0, 10)
  }, caveInfo);

  const lines = troText.split(/\r?\n/);
  let xmlLines = '';
  let id = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip blank lines, comments, and all keyword header lines
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
    const toStation   = parseStation(parts[1]);
    if (!fromStation || !toStation) continue;

    const length      = parseFloat(parts[2]);
    const azimuth     = parseFloat(parts[3]);
    const inclination = parseFloat(parts[4]);
    const left        = parseLRUD(parts[5]);
    const right       = parseLRUD(parts[6]);
    const up          = parseLRUD(parts[7]);
    const down        = parseLRUD(parts[8]);

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
    <länge>${length}</länge>
    <azimut>${azimuth}</azimut>
    <neigung>${inclination}</neigung>
    <querschnitt>0</querschnitt>
    <links>${left}</links>
    <rechts>${right}</rechts>
    <oben>${up}</oben>
    <unten>${down}</unten>
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
    <refX>0.0</refX>
    <refY>0.0</refY>
    <refZ>0.0</refZ>
    <x>0.0</x>
    <y>0.0</y>
    <z>0.0</z>
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

/** Escape special XML characters. */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Module-level storage for the loaded .tro file text. */
let currentTroText = null;

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

  currentTroText = null; // reset while loading
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('downloadLink').style.display = 'none';
  showStatus('Reading file…', 'info');

  const reader = new FileReader();
  reader.onload = function(e) {
    const troText = e.target.result;

    // Count real survey shots (skip header lines and splay shots)
    const lines = troText.split(/\r?\n/);
    let dataLines = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || /^[A-Za-z\[*]/.test(trimmed)) continue;
      const parts = trimmed.split(/\s+/);
      if (isDataLine(parts)) dataLines++;
    }

    // Parse header info
    const info = parseTroHeader(troText);

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
    currentTroText = troText;

    showStatus('File loaded — ' + dataLines + ' survey shots found.', 'success');
  };

  // Read as Latin-1 (ISO-8859-1) — the standard encoding for VTopo .tro files
  reader.readAsText(file, 'iso-8859-1');
}

/** Called when the user clicks "Convert". */
function convertFile() {
  const fileInput = document.getElementById('troFile');
  if (!fileInput.files[0] || !currentTroText) {
    return showStatus('Please select a .tro file first.', 'error');
  }

  const caveInfo = {
    cave_id: 0,
    kataster: parseInt(document.getElementById('caveKataster').value, 10) || 0,
    höhle:    document.getElementById('caveHöhle').value  || 'Unknown',
    name:     document.getElementById('caveName').value   || 'Unknown Cave',
    datum:    document.getElementById('caveDate').value   || new Date().toISOString().slice(0, 10)
  };

  const xml = troToCaveRenderXML(currentTroText, caveInfo);

  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);

  const link = document.getElementById('downloadLink');
  // Revoke previous object URL if any
  if (link.href && link.href.startsWith('blob:')) {
    URL.revokeObjectURL(link.href);
  }
  link.href = url;
  // Suggest a filename based on the input file name
  const inputName = fileInput.files[0].name.replace(/\.tro$/i, '');
  link.download = inputName + '_caverender.xml';
  link.style.display = 'inline-block';
  link.textContent = '⬇ Download XML';

  showStatus('Conversion complete! Click the download button to save the XML file.', 'success');
}