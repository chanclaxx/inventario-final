'use strict';

// ── Firma para QZ Tray (impresión directa de etiquetas) ─────────────────────
//
// QZ Tray es el programa que corre en el PC de la impresora y recibe los
// trabajos desde el navegador. Por seguridad pregunta «¿permitir que este sitio
// imprima?» en cada conexión, y sin un certificado de confianza no deja marcar
// «recordar». La salida gratuita es un certificado PROPIO:
//
//   · el certificado (público) vive en este repo, `qz-certificado.pem`, y el
//     mismo archivo se copia en cada PC como `override.crt` en la carpeta de
//     QZ Tray — eso le dice a QZ que confíe en él;
//   · la clave PRIVADA vive SOLO en Railway (`QZ_PRIVATE_KEY`, en PEM o en
//     base64) y firma lo que QZ pide firmar. Nunca se sirve.
//
// Sin la clave, `/qz/certificado` responde 404 y el frontend conecta SIN firma:
// QZ sigue imprimiendo, solo que pregunta cada vez. La feature nunca depende de
// la variable de entorno para funcionar, solo para no preguntar.
//
// `QZ_CERTIFICATE` permite cambiar el certificado sin desplegar código (por
// ejemplo, si se compra el oficial de QZ).

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const _pem = (valor) => {
  const v = String(valor || '').trim();
  if (!v) return null;
  if (v.includes('-----BEGIN')) return v.replace(/\\n/g, '\n');
  // En base64: Railway guarda bien las variables de una sola línea.
  try {
    const d = Buffer.from(v, 'base64').toString('utf8');
    return d.includes('-----BEGIN') ? d : null;
  } catch { return null; }
};

let _certCache;
const _certificado = () => {
  if (_certCache !== undefined) return _certCache;
  _certCache = _pem(process.env.QZ_CERTIFICATE);
  if (!_certCache) {
    try { _certCache = fs.readFileSync(path.join(__dirname, 'qz-certificado.pem'), 'utf8'); }
    catch { _certCache = null; }
  }
  return _certCache;
};

const _clave = () => _pem(process.env.QZ_PRIVATE_KEY);

/** El certificado, solo si además hay clave para firmar: uno sin el otro hace fallar a QZ. */
const certificado = () => (_clave() ? _certificado() : null);

/** Firma SHA-512 en base64, que es lo que QZ espera con `setSignatureAlgorithm('SHA512')`. */
const firmar = (texto) => {
  const clave = _clave();
  if (!clave) return null;
  const s = crypto.createSign('RSA-SHA512');
  s.update(String(texto ?? ''));
  return s.sign(clave, 'base64');
};

module.exports = { certificado, firmar };
