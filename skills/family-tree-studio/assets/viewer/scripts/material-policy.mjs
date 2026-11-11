import path from 'node:path';
import { createHash } from 'node:crypto';

// File type is derived from an allowlisted extension, never from user-supplied MIME.
// Unknown and active web formats are intentionally absent. Office/archive files are download-only.
const formats = {
  png: ['photo', 'image/png', 'image'], jpg: ['photo', 'image/jpeg', 'image'], jpeg: ['photo', 'image/jpeg', 'image'],
  webp: ['photo', 'image/webp', 'image'], avif: ['photo', 'image/avif', 'image'], gif: ['photo', 'image/gif', 'image'],
  pdf: ['document', 'application/pdf', 'pdf'], txt: ['document', 'text/plain; charset=utf-8', 'text'],
  tif: ['document', 'application/octet-stream', 'download'], tiff: ['document', 'application/octet-stream', 'download'],
  doc: ['document', 'application/octet-stream', 'download'], docx: ['document', 'application/octet-stream', 'download'],
  odt: ['document', 'application/octet-stream', 'download'], rtf: ['document', 'application/octet-stream', 'download'],
  csv: ['document', 'application/octet-stream', 'download'], xls: ['document', 'application/octet-stream', 'download'], xlsx: ['document', 'application/octet-stream', 'download'],
  mp3: ['audio', 'audio/mpeg', 'audio'], wav: ['audio', 'audio/wav', 'audio'], ogg: ['audio', 'audio/ogg', 'audio'], m4a: ['audio', 'audio/mp4', 'audio'],
  mp4: ['video', 'video/mp4', 'video'], webm: ['video', 'video/webm', 'video'], mov: ['video', 'video/quicktime', 'video'],
  zip: ['other', 'application/octet-stream', 'download'],
};
export const MATERIAL_EXTENSIONS = Object.freeze(Object.keys(formats));
export function materialType(fileName) {
  if (typeof fileName !== 'string') throw Error('Нужно имя файла материала');
  const extension = path.extname(fileName).slice(1).toLowerCase(), format = formats[extension];
  if (!format) throw Error(`Формат материала не поддерживается: ${extension || 'без расширения'}`);
  return { extension, kind: format[0], mediaType: format[1], preview: format[2] };
}
export function materialPath(value) {
  if (typeof value !== 'string' || !/^assets\/materials\/[a-zA-Z0-9_-]{1,120}\.[a-zA-Z0-9]+$/.test(value)) throw Error('Материал должен иметь путь assets/materials/<id>.<расширение> без переходов и подпапок');
  materialType(value);
  return value;
}
export function verifyMaterialBytes(input, fileName, expected = {}) {
  const bytes = Buffer.from(input), type = materialType(fileName);
  if (expected.size != null && bytes.length !== expected.size) throw Error(`Размер материала изменился: ${fileName}`);
  if (expected.sha256 && createHash('sha256').update(bytes).digest('hex') !== expected.sha256.toLowerCase()) throw Error(`Контрольная сумма материала изменилась: ${fileName}`);
  const starts = value => bytes.subarray(0, value.length).equals(Buffer.from(value));
  const ascii = (from, to) => bytes.subarray(from, to).toString('ascii');
  let valid = true;
  switch (type.extension) {
    case 'png': valid = starts([137,80,78,71,13,10,26,10]); break;
    case 'jpg': case 'jpeg': valid = starts([255,216,255]); break;
    case 'gif': valid = ['GIF87a','GIF89a'].includes(ascii(0,6)); break;
    case 'webp': valid = ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP'; break;
    case 'avif': valid = ascii(4,8) === 'ftyp' && /avif|avis/.test(ascii(8,40)); break;
    case 'pdf': valid = ascii(0,5) === '%PDF-'; break;
    case 'txt':
      try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); valid = !bytes.includes(0); } catch { valid = false; }
      break;
    case 'mp3': valid = ascii(0,3) === 'ID3' || (bytes.length >= 2 && bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0); break;
    case 'wav': valid = ascii(0,4) === 'RIFF' && ascii(8,12) === 'WAVE'; break;
    case 'ogg': valid = ascii(0,4) === 'OggS'; break;
    case 'm4a': case 'mp4': valid = ascii(4,8) === 'ftyp'; break;
    case 'mov': valid = ['ftyp','moov','wide','mdat'].includes(ascii(4,8)); break;
    case 'webm': valid = starts([26,69,223,163]); break;
  }
  if (!valid) throw Error(`Содержимое не соответствует формату ${type.extension}: ${fileName}`);
  return type;
}
export function materialDisposition(fileName, download = false) {
  const name = path.basename(String(fileName).replaceAll('\\','/')).replace(/[\r\n\u0000]/g,'').slice(0,180) || 'material';
  return `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`;
}
