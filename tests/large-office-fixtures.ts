import ExcelJS from "exceljs";
import JSZip from "jszip";
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const b of data) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer) {
  const kind = Buffer.from(type),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([kind, data])));
  return Buffer.concat([length, kind, data, crc]);
}
function png() {
  const width = 1900,
    height = 1900,
    header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row++)
    randomBytes(width * 4).copy(pixels, row * (width * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels, { level: 1 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
let pending: Promise<{ xlsx: Buffer; pptx: Buffer }> | undefined;
export function largeOfficeFiles() {
  return (pending ??= generate());
}
async function generate() {
  const wb = new ExcelJS.Workbook(),
    sheet = wb.addWorksheet("Customer performance");
  sheet.addRow([
    "ID",
    "Region",
    "Product",
    "Period",
    "Revenue",
    "Cost",
    "Customer",
    "Method notes",
    "Evidence detail",
  ]);
  for (let i = 0; i < 13000; i++)
    sheet.addRow([
      i + 1,
      ["NORTH", "SOUTH", "EAST", "WEST"][i % 4],
      ["Cloud", "Data", "Security"][i % 3],
      "2026-11",
      1000 + i,
      600 + i,
      "Customer " + i,
      randomBytes(384).toString("base64"),
      randomBytes(384).toString("base64"),
    ]);
  const xlsx = Buffer.from(
    await wb.xlsx.writeBuffer({ zip: { compression: "STORE" } }),
  );
  const zip = new JSZip(),
    p = "http://schemas.openxmlformats.org/presentationml/2006/main",
    a = "http://schemas.openxmlformats.org/drawingml/2006/main",
    r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const rel = (entries: { id: string; type: string; target: string }[]) =>
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.map((e) => `<Relationship Id="${e.id}" Type="${r}/${e.type}" Target="${e.target}"/>`).join("")}</Relationships>`;
  const tree = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${[
      ["/ppt/presentation.xml", "presentation.main"],
      ["/ppt/slides/slide1.xml", "slide"],
      ["/ppt/slideMasters/slideMaster1.xml", "slideMaster"],
      ["/ppt/slideLayouts/slideLayout1.xml", "slideLayout"],
    ]
      .map(
        ([part, type]) =>
          `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}+xml"/>`,
      )
      .join(
        "",
      )}<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    rel([
      { id: "rId1", type: "officeDocument", target: "ppt/presentation.xml" },
    ]),
  );
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId2"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    rel([
      { id: "rId1", type: "slide", target: "slides/slide1.xml" },
      {
        id: "rId2",
        type: "slideMaster",
        target: "slideMasters/slideMaster1.xml",
      },
    ]),
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld name="Customer performance evidence"><p:spTree>${tree}<p:pic><p:nvPicPr><p:cNvPr id="2" name="High resolution dashboard snapshot"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="600000" y="300000"/><a:ext cx="6000000" cy="6000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    rel([
      {
        id: "rId1",
        type: "slideLayout",
        target: "../slideLayouts/slideLayout1.xml",
      },
      { id: "rId2", type: "image", target: "../media/dashboard.png" },
    ]),
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<p:sldLayout xmlns:p="${p}" xmlns:a="${a}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    rel([
      {
        id: "rId1",
        type: "slideMaster",
        target: "../slideMasters/slideMaster1.xml",
      },
    ]),
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<p:sldMaster xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:spTree>${tree}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    rel([
      {
        id: "rId1",
        type: "slideLayout",
        target: "../slideLayouts/slideLayout1.xml",
      },
      { id: "rId2", type: "theme", target: "../theme/theme1.xml" },
    ]),
  );
  const colors = [
    "dk1",
    "lt1",
    "dk2",
    "lt2",
    "accent1",
    "accent2",
    "accent3",
    "accent4",
    "accent5",
    "accent6",
    "hlink",
    "folHlink",
  ]
    .map(
      (key, i) =>
        `<a:${key}><a:srgbClr val="${i % 2 ? "FFFFFF" : "102955"}"/></a:${key}>`,
    )
    .join("");
  zip.file(
    "ppt/theme/theme1.xml",
    `<a:theme xmlns:a="${a}" name="Corporate"><a:themeElements><a:clrScheme name="Corporate">${colors}</a:clrScheme><a:fontScheme name="Corporate"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Corporate"><a:fillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${'<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`,
  );
  zip.file("ppt/media/dashboard.png", png());
  const pptx = await zip.generateAsync({
    type: "nodebuffer",
    compression: "STORE",
  });
  return { xlsx, pptx };
}
