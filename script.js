function troToCaveRenderXML(troText, caveInfo = {}) {
  caveInfo = Object.assign({
    cave_id: 0,
    kataster: 0,
    höhle: "Unknown",
    name: "Unknown Cave",
    datum: "2023-01-01"
  }, caveInfo);

  const lines = troText.split(/\r?\n/);
  let xmlLines = '';
  let id = 0;

  lines.forEach(line => {
    const trimmed = line.trim();
    // Only parse lines with at least 6 numeric columns (from, to, length, azimuth, inclination, left, right, up, down)
    if (
      trimmed &&
      !trimmed.startsWith('*') &&
      !trimmed.startsWith('Version') &&
      !trimmed.startsWith('Verification') &&
      !trimmed.startsWith('Trou') &&
      !trimmed.startsWith('Club') &&
      !trimmed.startsWith('Entree') &&
      !trimmed.startsWith('Toporobot') &&
      !trimmed.startsWith('Couleur') &&
      !trimmed.startsWith('Param')
    ) {
      const parts = trimmed.split(/\s+/);
      // Only lines with at least 6 columns and all are numbers or station names
      if (parts.length >= 8 && !isNaN(parseFloat(parts[2]))) {
        const [from, to, length, azimuth, inclination, left, right, up, down] = parts;
        xmlLines += `
    <line>
      <cave_id>${caveInfo.cave_id}</cave_id>
      <id>${id}</id>
      <kataster>${caveInfo.kataster}</kataster>
      <höhle>${caveInfo.höhle}</höhle>
      <gang>1</gang>
      <punkt></punkt>
      <start>0.0</start>
      <ende>0.0</ende>
      <tiefe>0.0</tiefe>
      <refTiefe>0.0</refTiefe>
      <länge>${parseFloat(length)}</länge>
      <azimut>${parseFloat(azimuth)}</azimut>
      <neigung>${parseFloat(inclination)}</neigung>
      <links>${parseFloat(left)}</links>
      <rechts>${parseFloat(right)}</rechts>
      <oben>${parseFloat(up)}</oben>
      <unten>${parseFloat(down)}</unten>
      <gerät>4</gerät>
      <richtung>1.0</richtung>
      <gewicht>0.0</gewicht>
      <ring>0</ring>
      <farbe>4</farbe>
      <ebene>1</ebene>
      <datum>${caveInfo.datum}</datum>
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
    }
  });

  // XML header and cave info
  const xmlHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<CaveRenderPro>
  <version>CaveRenderPro 12.2.0, © 2015 - 2025 Jochen Hartig, www.caverender.de</version>
  <cave>
    <cave_id>${caveInfo.cave_id}</cave_id>
    <kataster>${caveInfo.kataster}</kataster>
    <höhle>${caveInfo.höhle}</höhle>
    <name>${caveInfo.name}</name>
    <datum>${caveInfo.datum}</datum>
  </cave>
`;

  const xmlFooter = `
</CaveRenderPro>`;

  return xmlHeader + xmlLines + xmlFooter;
}

function convertFile() {
  const fileInput = document.getElementById('troFile');
  const file = fileInput.files[0];
  if (!file) return alert("Please select a .tro file");

  const reader = new FileReader();
  reader.onload = function(e) {
    const troText = e.target.result;
    // You can customize caveInfo here if needed
    const xml = troToCaveRenderXML(troText, {
      höhle: "Trifón",
      name: "Trou T001 Trifón",
      datum: "2020-10-15"
    });

    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);

    const link = document.getElementById("downloadLink");
    link.href = url;
    link.download = "converted.xml";
    link.style.display = "inline-block";
    link.textContent = "Download CaveRender XML";
  };

  reader.readAsText(file);
}