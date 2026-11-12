import{r as e}from"./chunk-CilyBKbf.js";import{Sr as t,ct as n,d as r,f as i,hn as a,lt as o,ot as s,p as c,sr as l,st as u,t as d,v as f,vr as p}from"./index-DFiguOCF.js";import{a as m,p as h}from"./doctorPaymentsPdf-B6GfPPcb.js";import{n as g}from"./activo-DqM16XUX.js";import{_,c as v}from"./icons-BGm7mbZm.js";/* empty css                        */var y=e(t(),1);function b(e){if(!e)return`—`;let t=e.split(`T`)[0],n=/^(\d{4})-(\d{2})-(\d{2})$/.exec(t);return n?`${n[3]}/${n[2]}/${n[1]}`:t}function x({orden:e,patient:t,centroNombre:n=`SANATORIO`,consumo:r}){let i=new h({orientation:`portrait`,unit:`mm`,format:`a4`}),a=d();function o(o,s){i.setDrawColor(31,42,68),i.setLineWidth(.35),i.roundedRect(10,o,190,135,1.5,1.5,`S`),i.setDrawColor(31,42,68),i.setLineWidth(.25),i.line(82,o,82,o+21),i.line(142,o,142,o+21),i.line(10,o+21,200,o+21);let c=14;if(a?.dataUrl){let e=13*(a.aspect||1.3);try{i.addImage(a.dataUrl,a.format,13,o+4,e,13),c=13+e+3}catch{}}i.setTextColor(31,42,68),i.setFont(`helvetica`,`bold`),i.setFontSize(11),i.text(n,c,o+11.5),i.setFont(`helvetica`,`bold`),i.setFontSize(12),i.setTextColor(31,42,68),i.text(`ORDEN MÉDICA`,112,o+8.5,{align:`center`}),i.setFontSize(8),i.setFont(`helvetica`,`bold`),s===`COPIA OFICINA`?(i.setTextColor(30,64,175),i.text(`COPIA OFICINA`,112,o+15,{align:`center`})):(i.setTextColor(13,148,136),i.text(`COPIA PACIENTE`,112,o+15,{align:`center`})),i.setFont(`helvetica`,`bold`),i.setFontSize(11),i.setTextColor(28,127,150),i.text(e.numero,171,o+9,{align:`center`}),i.setFont(`helvetica`,`normal`),i.setFontSize(7.5),i.setTextColor(71,85,105),i.text(`Emisión: ${b(e.fecha)}`,171,o+14.5,{align:`center`});let l=o+21,u=190*.17;76-u;let d=124+u;i.setDrawColor(203,213,225),i.setLineWidth(.2),i.line(124,l,124,l+24),i.line(d,l,d,l+24),i.line(10,l+24,200,l+24),i.setFont(`helvetica`,`bold`),i.setFontSize(7),i.setTextColor(62,76,89),i.text(`CONTRATANTE / PACIENTE`,14,l+4.5);let f=`${t.apellido}, ${t.nombre}`.toUpperCase();i.setFont(`helvetica`,`bold`),i.setFontSize(9.5),i.setTextColor(31,42,68),i.getTextWidth(f)>106&&i.setFontSize(8),i.text(f,14,l+9.5,{maxWidth:106}),i.setFont(`helvetica`,`bold`),i.setFontSize(7),i.setTextColor(62,76,89),i.text(`DNI`,127,l+4.5),i.setFont(`helvetica`,`bold`),i.setFontSize(9),i.setTextColor(31,42,68),i.text(t.dni||`—`,127,l+9.5),i.setFont(`helvetica`,`bold`),i.setFontSize(7),i.setTextColor(62,76,89),i.text(`COBERTURA`,d+3,l+4.5),i.setFont(`helvetica`,`bold`),i.setFontSize(9),i.setTextColor(28,127,150);let p=(e.planNombre||`Afiliado`).trim(),m=p.replace(/^plan\s+/i,``).trim()||p;i.text(m.toUpperCase(),d+3,l+9.5,{maxWidth:37.699999999999996});let h=l+12;i.setFont(`helvetica`,`bold`),i.setFontSize(7),i.setTextColor(62,76,89),i.text(`TIPO DE ORDEN`,14,h+3.5);let g=e.tipo===`consulta`,_=3.2,v=h+5.5;i.setDrawColor(123,135,148),i.setLineWidth(.3),i.rect(14,v,_,_),g&&(i.setFont(`helvetica`,`bold`),i.setFontSize(7),i.setTextColor(31,42,68),i.text(`X`,14.8,v+2.6)),i.setFont(`helvetica`,g?`bold`:`normal`),i.setFontSize(8),i.setTextColor(31,42,68),i.text(`Consulta`,14+_+2,v+2.6);let y=14+_+20;if(r){let e=4.2,t=14+_+16,n=v-.6;g?(i.setFillColor(225,242,246),i.setDrawColor(180,220,230),i.roundedRect(t,n,12,e,1,1,`FD`),i.setFont(`helvetica`,`bold`),i.setFontSize(7),i.setTextColor(28,127,150)):(i.setFillColor(238,241,245),i.setDrawColor(215,220,226),i.roundedRect(t,n,12,e,1,1,`FD`),i.setFont(`helvetica`,`bold`),i.setFontSize(7),i.setTextColor(107,119,133));let a=`${r.consultasUsadas}-${r.consultasCupo}`;i.text(a,t+12/2,n+3.1,{align:`center`}),y=t+12+6}let x=e.tipo===`prestacion`,S=y,C=v;if(i.setDrawColor(123,135,148),i.setLineWidth(.3),i.rect(S,C,_,_),x&&(i.setFont(`helvetica`,`bold`),i.setFontSize(7),i.setTextColor(31,42,68),i.text(`X`,S+.8,C+2.6)),i.setFont(`helvetica`,x?`bold`:`normal`),i.setFontSize(8),i.setTextColor(31,42,68),i.text(`Prestación`,S+_+2,C+2.6),r){let e=4.2,t=S+_+18,n=C-.6;x?(i.setFillColor(225,242,246),i.setDrawColor(180,220,230),i.roundedRect(t,n,12,e,1,1,`FD`),i.setFont(`helvetica`,`bold`),i.setFontSize(7),i.setTextColor(28,127,150)):(i.setFillColor(238,241,245),i.setDrawColor(215,220,226),i.roundedRect(t,n,12,e,1,1,`FD`),i.setFont(`helvetica`,`bold`),i.setFontSize(7),i.setTextColor(107,119,133));let a=`${r.prestacionesUsadas}-${r.prestacionesCupo}`;i.text(a,t+12/2,n+3.1,{align:`center`})}i.setFont(`helvetica`,`bold`),i.setFontSize(7),i.setTextColor(62,76,89),i.text(`FECHA DE EMISIÓN`,127,h+3.5),i.setFont(`helvetica`,`bold`),i.setFontSize(8.5),i.setTextColor(31,42,68),i.text(b(e.fecha),127,h+9),i.setFont(`helvetica`,`bold`),i.setFontSize(7),i.setTextColor(62,76,89),i.text(`ESTADO`,d+3,h+3.5),i.setFont(`helvetica`,`normal`),i.setFontSize(8),i.setTextColor(71,85,105),i.text(`Vigente · Activo`,d+3,h+9);let w=l+24;i.line(10,w+21,200,w+21),i.setFont(`helvetica`,`bold`),i.setFontSize(8),i.setTextColor(62,76,89),i.text(`PRESTACIÓN`,14,w+4.5);let T=e.tipo===`consulta`?`CONSULTA MÉDICA EN CONSULTORIO`:(e.prestacionNombre||`PRESTACIÓN MÉDICA`).toUpperCase(),E=11;T.length>55?E=8.5:T.length>38&&(E=9.5),i.setFont(`helvetica`,`bold`),i.setFontSize(E),i.setTextColor(28,127,150),i.text(T,14,w+10.5,{maxWidth:182}),i.setFont(`helvetica`,`normal`),i.setFontSize(8),i.setTextColor(62,76,89);let D=e.medicoNombre?`Pedido del médico: ${e.medicoNombre}`:`Pedido del médico: No especificado`;i.text(D,14,w+16.5,{maxWidth:182});let O=w+21;i.line(10,O+17,200,O+17),i.setFont(`helvetica`,`bold`),i.setFontSize(7),i.setTextColor(62,76,89),i.text(`OBSERVACIONES / DIAGNÓSTICO PRESUNTIVO`,14,O+4.5),i.setFont(`helvetica`,`normal`),i.setFontSize(7.5),i.setTextColor(31,42,68);let k=e.observaciones?.trim()||`Sin observaciones registradas.`,A=i.splitTextToSize(k,182);i.text(A.slice(0,2),14,O+9.5);let j=O+17;135-(j-o),i.setDrawColor(203,213,225),i.setLineWidth(.2),i.line(105,j,105,o+135);let M=j+34,N=27.5;i.setDrawColor(203,213,225),i.setLineWidth(.3),i.line(N,M,N+60,M),i.setFontSize(8),i.setFont(`helvetica`,`bold`),i.setTextColor(62,76,89),s===`COPIA OFICINA`?(i.text(`Firma del Contratante`,N+60/2,M+4.5,{align:`center`}),i.setFont(`helvetica`,`normal`),i.setFontSize(7),i.setTextColor(100,116,139),i.text(`Conformidad de atención`,N+60/2,M+8.5,{align:`center`})):(i.text(`Sello del centro`,N+60/2,M+4.5,{align:`center`}),i.setFont(`helvetica`,`normal`),i.setFontSize(7),i.setTextColor(100,116,139),i.text(`Recepción y control`,N+60/2,M+8.5,{align:`center`}));let P=122.5;i.setDrawColor(203,213,225),i.setLineWidth(.3),i.line(P,M,P+60,M),i.setFontSize(8),i.setFont(`helvetica`,`bold`),i.setTextColor(62,76,89),i.text(`Firma y Sello del Profesional`,P+60/2,M+4.5,{align:`center`}),i.setFont(`helvetica`,`normal`),i.setFontSize(7),i.setTextColor(100,116,139),i.text(`Aclaración / Matrícula`,P+60/2,M+8.5,{align:`center`})}o(10,`COPIA OFICINA`);let s=148.5;return i.setDrawColor(179,186,196),i.setLineWidth(.4),i.setLineDashPattern([2,2],0),i.line(10,s,200,s),i.setLineDashPattern([],0),o(152,`COPIA PACIENTE`),{doc:i,filename:`orden-medica-${e.numero}-${t.apellido||`paciente`}.pdf`.toLowerCase().replace(/\s+/g,`-`)}}function S(e){return String(e??``).replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`).replace(/'/g,`&#039;`)}function C({orden:e,patient:t,centroNombre:n=`SANATORIO`,consumo:r}){let i=d();function a(a){let o=a===`COPIA OFICINA`,s=e.tipo===`consulta`,c=e.tipo===`prestacion`,l=`${t.apellido}, ${t.nombre}`.toUpperCase(),u=t.dni||`—`,d=(e.planNombre||`Afiliado`).trim(),f=(d.replace(/^plan\s+/i,``).trim()||d).toUpperCase(),p=b(e.fecha),m=s?`CONSULTA MÉDICA EN CONSULTORIO`:(e.prestacionNombre||`PRESTACIÓN MÉDICA`).toUpperCase(),h=e.medicoNombre?`Pedido del médico: ${e.medicoNombre}`:`Pedido del médico: No especificado`,g=e.observaciones?.trim()||`Sin observaciones registradas.`,_=i?.dataUrl;return`
      <div class="copy-box">
        <!-- Encabezado -->
        <div class="head">
          <div class="head-col1">
            ${_?`<img src="${_}" style="height: 13mm; max-width: 22mm; object-fit: contain;" alt="Logo" />`:``}
            <div>
              <div style="font-size: 11pt; font-weight: 700; color: #1F2A44; line-height: 1.1;">${S(n)}</div>
            </div>
          </div>
          <div class="head-col2">
            <div style="font-size: 12pt; font-weight: 700; color: #1F2A44; letter-spacing: 0.5px;">ORDEN MÉDICA</div>
            <div style="font-size: 8pt; font-weight: 700; color: ${o?`#1E40AF`:`#0D9488`}; margin-top: 2px;">${a}</div>
          </div>
          <div class="head-col3">
            <div style="font-size: 11pt; font-weight: 700; color: #1C7F96;">${S(e.numero)}</div>
            <div style="font-size: 7.5pt; color: #475569; margin-top: 2px;">Emisión: ${p}</div>
          </div>
        </div>

        <!-- Grilla 3 columnas -->
        <div class="grid-block">
          <div class="grid-col1">
            <div>
              <div class="lbl">CONTRATANTE / PACIENTE</div>
              <div class="val" style="margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${S(l)}</div>
            </div>
            <div>
              <div class="lbl">TIPO DE ORDEN</div>
              <div style="display: flex; align-items: center; gap: 14px; margin-top: 2px; font-size: 8pt;">
                <span style="display: inline-flex; align-items: center; gap: 4px; font-weight: ${s?`700`:`400`};">
                  <span style="display: inline-block; width: 12px; height: 12px; border: 1px solid #7B8794; text-align: center; line-height: 12px; font-size: 8pt; font-weight: 700;">${s?`X`:``}</span>
                  Consulta
                  ${r?`<span class="pill ${s?`pill-active`:`pill-inactive`}">${r.consultasUsadas}-${r.consultasCupo}</span>`:``}
                </span>
                <span style="display: inline-flex; align-items: center; gap: 4px; font-weight: ${c?`700`:`400`};">
                  <span style="display: inline-block; width: 12px; height: 12px; border: 1px solid #7B8794; text-align: center; line-height: 12px; font-size: 8pt; font-weight: 700;">${c?`X`:``}</span>
                  Prestación
                  ${r?`<span class="pill ${c?`pill-active`:`pill-inactive`}">${r.prestacionesUsadas}-${r.prestacionesCupo}</span>`:``}
                </span>
              </div>
            </div>
          </div>

          <div class="grid-col2">
            <div>
              <div class="lbl">DNI</div>
              <div class="val" style="margin-top: 1px;">${S(u)}</div>
            </div>
            <div>
              <div class="lbl">FECHA DE EMISIÓN</div>
              <div class="val" style="margin-top: 1px; font-size: 8.5pt;">${p}</div>
            </div>
          </div>

          <div class="grid-col3">
            <div>
              <div class="lbl">COBERTURA</div>
              <div class="val" style="margin-top: 1px; color: #1C7F96; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${S(f)}</div>
            </div>
            <div>
              <div class="lbl">ESTADO</div>
              <div style="font-size: 8pt; color: #475569; margin-top: 1px;">Vigente · Activo</div>
            </div>
          </div>
        </div>

        <!-- Prestación -->
        <div class="prestacion-block">
          <div>
            <div class="lbl">PRESTACIÓN</div>
            <div style="font-size: ${m.length>55?`8.5pt`:m.length>38?`9.5pt`:`11pt`}; font-weight: 700; color: #1C7F96; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${S(m)}</div>
          </div>
          <div style="font-size: 8pt; color: #3E4C59;">${S(h)}</div>
        </div>

        <!-- Observaciones -->
        <div class="obs-block">
          <div class="lbl">OBSERVACIONES / DIAGNÓSTICO PRESUNTIVO</div>
          <div style="font-size: 7.5pt; color: #1F2A44; line-height: 1.3; margin-top: 1px; max-height: 8mm; overflow: hidden;">${S(g)}</div>
        </div>

        <!-- Firmas -->
        <div class="firmas-block">
          <div class="firma-col">
            <div style="width: 60mm; border-top: 1px solid #CBD5E1; text-align: center; padding-top: 4px;">
              <div style="font-size: 8pt; font-weight: 700; color: #3E4C59;">${o?`Firma del Contratante`:`Sello del centro`}</div>
              <div style="font-size: 7pt; color: #64748B;">${o?`Conformidad de atención`:`Recepción y control`}</div>
            </div>
          </div>
          <div class="firma-col">
            <div style="width: 60mm; border-top: 1px solid #CBD5E1; text-align: center; padding-top: 4px;">
              <div style="font-size: 8pt; font-weight: 700; color: #3E4C59;">Firma y Sello del Profesional</div>
              <div style="font-size: 7pt; color: #64748B;">Aclaración / Matrícula</div>
            </div>
          </div>
        </div>
      </div>
    `}return`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Orden Médica ${e.numero}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm 10mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      width: 190mm;
      margin: 0 auto;
    }
    .sheet {
      width: 190mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 278mm;
    }
    .copy-box {
      border: 1.2px solid #1F2A44;
      border-radius: 4px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      height: 134mm;
      background: #ffffff;
    }
    .head {
      display: flex;
      height: 21mm;
      border-bottom: 1.2px solid #1F2A44;
    }
    .head-col1 {
      width: 72mm;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
    }
    .head-col2 {
      width: 60mm;
      border-left: 1px solid #1F2A44;
      border-right: 1px solid #1F2A44;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .head-col3 {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .grid-block {
      display: flex;
      height: 24mm;
      border-bottom: 1px solid #1F2A44;
    }
    .grid-col1 {
      width: 60%;
      padding: 4px 10px;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
      border-right: 1px solid #CBD5E1;
    }
    .grid-col2 {
      width: 17%;
      padding: 4px 8px;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
      border-right: 1px solid #CBD5E1;
    }
    .grid-col3 {
      width: 23%;
      padding: 4px 8px;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
    }
    .prestacion-block {
      height: 21mm;
      padding: 4px 10px;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
      border-bottom: 1px solid #1F2A44;
    }
    .obs-block {
      height: 17mm;
      padding: 4px 10px;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
      border-bottom: 1px solid #1F2A44;
    }
    .firmas-block {
      flex: 1;
      display: flex;
    }
    .firma-col {
      width: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      padding-bottom: 10px;
    }
    .firma-col:first-child {
      border-right: 1px solid #CBD5E1;
    }
    .cut-line {
      border-top: 1.5px dashed #B3BAC4;
      width: 190mm;
      margin: 4mm 0;
    }
    .lbl {
      font-size: 7.5pt;
      font-weight: 700;
      color: #3E4C59;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .val {
      font-size: 9.5pt;
      font-weight: 700;
      color: #1F2A44;
    }
    .pill {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 7pt;
      font-weight: 700;
    }
    .pill-active {
      background: #E1F2F6;
      border: 1px solid #B4DCE6;
      color: #1C7F96;
    }
    .pill-inactive {
      background: #EEF1F5;
      border: 1px solid #D7DCE2;
      color: #6B7785;
    }
  </style>
</head>
<body>
  <div class="sheet">
    ${a(`COPIA OFICINA`)}
    <div class="cut-line"></div>
    ${a(`COPIA PACIENTE`)}
  </div>
</body>
</html>`}var w=p();function T({onClose:e,prestacionSeleccionada:t,onPrestacionEliminada:n}){let{prestacionesAfiliados:i,upsertPrestacionAfiliado:a,deletePrestacionAfiliado:c}=r(),[l,u]=(0,y.useState)(``),[d,f]=(0,y.useState)(s[0]),[p,m]=(0,y.useState)(``),[h,g]=(0,y.useState)(``),[b,x]=(0,y.useState)(null),[S,C]=(0,y.useState)(null);(0,y.useEffect)(()=>{function t(t){t.key===`Escape`&&e()}return window.addEventListener(`keydown`,t),()=>window.removeEventListener(`keydown`,t)},[e]);let T=(0,y.useMemo)(()=>{let e=new Set(s);return i.forEach(t=>{t.grupo&&e.add(t.grupo.toUpperCase())}),[...e]},[i]),E=(0,y.useMemo)(()=>{let e=o(h);return e?i.filter(t=>o(t.nombre).includes(e)||o(t.grupo).includes(e)):i},[i,h]),D=(0,y.useMemo)(()=>{let e=new Map;return E.forEach(t=>{let n=t.grupo||`PROCEDIMIENTOS Y OTROS`,r=e.get(n)??[];r.push(t),e.set(n,r)}),e},[E]);function O(e){e.preventDefault(),x(null),C(null);let t=l.trim();if(!t){x(`El nombre de la prestación es obligatorio.`);return}let n=d===`__OTRO__`?p.trim().toUpperCase():d.trim().toUpperCase();if(!n){x(`Indicá el grupo o categoría de la prestación.`);return}let r=a({nombre:t,grupo:n,activa:!0});if(!r.ok){x(r.error||`No se pudo agregar la prestación.`);return}C(`"${t}" agregada correctamente.`),u(``),m(``),setTimeout(()=>C(null),3500)}function k(e,r){if(x(null),C(null),!window.confirm(`¿Quitar la prestación "${r}" de la lista?`))return;let i=c(e);i.ok?(t&&o(t)===o(r)&&n?.(r),C(`"${r}" fue quitada de la lista.`),setTimeout(()=>C(null),3e3)):x(i.error||`No se pudo quitar la prestación.`)}return(0,w.jsx)(`div`,{className:`af-modal-backdrop`,style:{zIndex:1100},role:`presentation`,onMouseDown:t=>{t.target===t.currentTarget&&e()},children:(0,w.jsxs)(`div`,{className:`af-modal af-modal-dialog`,style:{width:`100%`,maxWidth:760,maxHeight:`90vh`,display:`flex`,flexDirection:`column`},role:`dialog`,"aria-modal":`true`,"aria-labelledby":`prest-modal-title`,children:[(0,w.jsxs)(`div`,{className:`af-modal__head`,style:{borderBottom:`1px solid var(--border)`},children:[(0,w.jsxs)(`div`,{children:[(0,w.jsx)(`h2`,{id:`prest-modal-title`,style:{margin:0,fontSize:`1.15rem`,color:`var(--heading)`},children:`Prestaciones`}),(0,w.jsxs)(`span`,{style:{fontSize:`0.8rem`,color:`#64748b`},children:[i.length,` prestación`,i.length===1?``:`es`,` en la lista`]})]}),(0,w.jsx)(`button`,{type:`button`,className:`af-btn af-btn--icon`,onClick:e,"aria-label":`Cerrar modal de prestaciones`,title:`Cerrar (Esc)`,children:`✕`})]}),b&&(0,w.jsx)(`div`,{style:{margin:`0.6rem 1.2rem 0`,padding:`0.45rem 0.75rem`,background:`#fef2f2`,border:`1px solid #fecaca`,color:`#b91c1c`,borderRadius:`6px`,fontSize:`0.82rem`,fontWeight:600},children:b}),S&&(0,w.jsx)(`div`,{style:{margin:`0.6rem 1.2rem 0`,padding:`0.45rem 0.75rem`,background:`#f0fdf4`,border:`1px solid #bbf7d0`,color:`#15803d`,borderRadius:`6px`,fontSize:`0.82rem`,fontWeight:600},children:S}),(0,w.jsxs)(`div`,{style:{flex:1,overflowY:`auto`,padding:`1rem 1.2rem`,display:`flex`,flexDirection:`column`,gap:`1rem`},children:[(0,w.jsxs)(`div`,{style:{background:`#f8fafc`,border:`1px solid var(--border)`,borderRadius:`8px`,padding:`0.85rem`},children:[(0,w.jsx)(`div`,{style:{fontSize:`0.85rem`,fontWeight:700,color:`var(--heading)`,marginBottom:`0.55rem`},children:`Agregar nueva prestación`}),(0,w.jsxs)(`form`,{onSubmit:O,style:{display:`flex`,flexDirection:`column`,gap:`0.6rem`},children:[(0,w.jsxs)(`div`,{style:{display:`grid`,gridTemplateColumns:`1.4fr 1fr`,gap:`0.5rem`},children:[(0,w.jsx)(`input`,{type:`text`,className:`af-input`,placeholder:`Nombre de la prestación…`,value:l,onChange:e=>{u(e.target.value),b&&x(null)},"aria-label":`Nombre de la prestación`}),(0,w.jsxs)(`select`,{className:`af-select`,value:d,onChange:e=>{f(e.target.value),b&&x(null)},"aria-label":`Categoría o grupo`,children:[T.map(e=>(0,w.jsx)(`option`,{value:e,children:e},e)),(0,w.jsx)(`option`,{value:`__OTRO__`,children:`+ Otro grupo nuevo…`})]})]}),d===`__OTRO__`&&(0,w.jsx)(`input`,{type:`text`,className:`af-input`,placeholder:`Escribí el nuevo grupo o categoría…`,value:p,onChange:e=>m(e.target.value),"aria-label":`Nuevo grupo`}),(0,w.jsx)(`div`,{style:{display:`flex`,justifyContent:`flex-end`},children:(0,w.jsxs)(`button`,{type:`submit`,className:`af-btn af-btn--primary`,style:{padding:`0.35rem 0.85rem`,fontSize:`0.84rem`},children:[(0,w.jsx)(v,{}),` Agregar`]})})]})]}),(0,w.jsx)(`div`,{children:(0,w.jsx)(`input`,{type:`text`,className:`af-input`,placeholder:`Buscar prestación o categoría…`,value:h,onChange:e=>g(e.target.value),"aria-label":`Buscar prestación`,style:{width:`100%`}})}),(0,w.jsx)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:`0.85rem`},children:D.size===0?(0,w.jsxs)(`div`,{style:{textAlign:`center`,padding:`1.5rem`,color:`#94a3b8`,fontSize:`0.85rem`},children:[`No se encontraron prestaciones para "`,h,`".`]}):[...D.entries()].map(([e,t])=>(0,w.jsxs)(`div`,{style:{border:`1px solid #e2e8f0`,borderRadius:`8px`,overflow:`hidden`},children:[(0,w.jsxs)(`div`,{style:{background:`#f1f5f9`,padding:`0.4rem 0.75rem`,fontSize:`0.78rem`,fontWeight:800,color:`#334155`,letterSpacing:`0.03em`},children:[e,` (`,t.length,`)`]}),(0,w.jsx)(`div`,{style:{background:`#ffffff`},children:t.map(e=>(0,w.jsxs)(`div`,{style:{display:`flex`,alignItems:`center`,justifyContent:`space-between`,padding:`0.45rem 0.75rem`,borderTop:`1px solid #f8fafc`,gap:`0.5rem`},children:[(0,w.jsx)(`span`,{style:{fontSize:`0.84rem`,color:`#1e293b`,fontWeight:500},children:e.nombre}),(0,w.jsx)(`button`,{type:`button`,className:`af-btn af-btn--icon af-btn--danger`,onClick:()=>k(e.id,e.nombre),"aria-label":`Quitar prestación ${e.nombre}`,title:`Quitar de la lista`,style:{padding:`0.2rem`},children:(0,w.jsx)(_,{})})]},e.id))})]},e))})]}),(0,w.jsx)(`div`,{className:`af-modal__foot`,style:{borderTop:`1px solid var(--border)`,justifyContent:`flex-end`},children:(0,w.jsx)(`button`,{type:`button`,className:`af-btn af-btn--primary`,onClick:e,children:`Listo`})})]})})}function E({onClose:e,afiliadoSeleccionadoId:t,onPreviewPdf:s}){let{data:d,prestacionesAfiliados:p,ordenesMedicas:h,emitirOrdenMedica:_}=r(),{session:v}=a(),b=(0,y.useMemo)(()=>{let e=[],t=d.planesAfiliados??[],n=d.patients??[],r=(d.afiliados??[]).filter(e=>!i(e));for(let a of r){let r=t.find(e=>e.id===a.planId)?.nombre||`Plan de Afiliado`,o=c(a),s=i(a),l=n.find(e=>e.id===a.patientId);if(l&&e.push({patientId:l.id,afiliadoId:a.id,apellido:l.apellido,nombre:l.nombre,dni:l.dni||``,planId:a.planId,planNombre:r,esAdherente:!1,suspendido:o,dadoDeBaja:s}),Array.isArray(a.adherentes))for(let t of a.adherentes){let i=n.find(e=>e.id===t.patientId);i&&e.push({patientId:i.id,afiliadoId:a.id,apellido:i.apellido,nombre:i.nombre,dni:i.dni||``,planId:a.planId,planNombre:r,esAdherente:!0,relacion:t.relacion||`Adherente`,suspendido:o,dadoDeBaja:s})}}return e.sort((e,t)=>e.apellido.localeCompare(t.apellido,`es`))},[d.afiliados,d.planesAfiliados,d.patients]),[S,E]=(0,y.useState)(()=>t||``);(0,y.useEffect)(()=>{t&&E(t)},[t]);let[D,O]=(0,y.useState)(`consulta`),[k,A]=(0,y.useState)(``),[j,M]=(0,y.useState)(``),[N,P]=(0,y.useState)(()=>l(new Date,`yyyy-MM-dd`)),[F,I]=(0,y.useState)(``),L=(0,y.useMemo)(()=>[...g(d.doctors??[])].sort((e,t)=>`${e.apellido} ${e.nombre}`.localeCompare(`${t.apellido} ${t.nombre}`,`es`,{sensitivity:`base`})),[d.doctors]),R=(0,y.useMemo)(()=>j?(d.doctors??[]).find(e=>e.id===j)??null:null,[d.doctors,j]),z=(0,y.useMemo)(()=>{if(!R)return;let e=R.apellido?`${R.apellido}, `:``,t=R.especialidad?` (${R.especialidad})`:``;return`${e}${R.nombre}${t}`},[R]),[B,V]=(0,y.useState)(!1),[H,U]=(0,y.useState)(null),[W,G]=(0,y.useState)(null);(0,y.useEffect)(()=>{function t(t){t.key===`Escape`&&!B&&e()}return window.addEventListener(`keydown`,t),()=>window.removeEventListener(`keydown`,t)},[e,B]);let K=(0,y.useMemo)(()=>b.find(e=>e.patientId===S)??null,[b,S]),q=(0,y.useMemo)(()=>{if(!K)return null;let e=(d.planesAfiliados??[]).find(e=>e.id===K.planId);if(!e)return null;let t=new Date;try{if(N){let e=N.split(`-`).map(Number);e.length===3&&(t=new Date(e[0],e[1]-1,e[2]))}}catch{}let n=f({patientId:K.patientId,anio:t.getFullYear(),mes:t.getMonth()+1,plan:e,appointments:d.appointments??[],ordenesMedicas:h??[]});return{plan:e,consumo:n,textoConsultas:e.cupoConsultas>0?`${n.consultasUsadas} de ${e.cupoConsultas}`:`${n.consultasUsadas} (sin límite)`,textoPrestaciones:(e.prestacionesPorMes??0)>0?`${n.prestacionesUsadas} de ${e.prestacionesPorMes}`:`${n.prestacionesUsadas} (sin límite)`}},[K,d.planesAfiliados,d.appointments,h,N]),J=(0,y.useMemo)(()=>u(p.filter(e=>e.activa),!0),[p]),Y=(0,y.useMemo)(()=>!(!S||K?.suspendido||K?.dadoDeBaja||D===`prestacion`&&!k.trim()),[S,K,D,k]);function X(e){if(!K)return null;let t=(d.patients??[]).find(e=>e.id===K.patientId);return t?x({orden:e??{id:`preview`,numero:n(h),patientId:K.patientId,afiliadoId:K.afiliadoId,planNombre:K.planNombre,tipo:D,prestacionNombre:D===`prestacion`?k:void 0,medicoId:j||void 0,medicoNombre:z,fecha:N||l(new Date,`yyyy-MM-dd`),observaciones:F,usuario:v?.displayName||v?.username||`Administración`,creadaEn:new Date().toISOString()},patient:t,centroNombre:`SANATORIO`,consumo:q?{consultasUsadas:q.consumo.consultasUsadas,consultasCupo:q.plan.cupoConsultas,prestacionesUsadas:q.consumo.prestacionesUsadas,prestacionesCupo:q.plan.prestacionesPorMes??0}:void 0}):null}function Z(){G(null);let e=X(H??void 0);e&&s({url:m(e.doc),filename:e.filename,title:`Orden Médica ${H?.numero||`Borrador`}`,doc:e.doc,hidePrint:!0})}function Q(){if(G(null),!K)return;let e=H??void 0;if(!e)return;let t=(d.patients??[]).find(e=>e.id===K.patientId);if(!t)return;let n=C({orden:e,patient:t,centroNombre:`SANATORIO`,consumo:q?{consultasUsadas:q.consumo.consultasUsadas,consultasCupo:q.plan.cupoConsultas??0,prestacionesUsadas:q.consumo.prestacionesUsadas,prestacionesCupo:q.plan.prestacionesPorMes??0}:void 0}),r=document.createElement(`iframe`);r.style.position=`fixed`,r.style.top=`-10000px`,r.style.left=`-10000px`,r.style.width=`0`,r.style.height=`0`,r.style.border=`none`,document.body.appendChild(r);let i=r.contentWindow?.document;i&&(i.open(),i.write(n),i.close(),setTimeout(()=>{try{r.contentWindow?.focus(),r.contentWindow?.print()}catch(e){console.error(`Error al invocar impresión directa:`,e)}finally{setTimeout(()=>{try{document.body.removeChild(r)}catch{}},3e4)}},250))}function $(){if(G(null),!K){G(`Seleccioná un contratante o paciente.`);return}if(K.dadoDeBaja){G(`Contratante dado de baja`);return}if(K.suspendido){G(`Contratante suspendido`);return}if(D===`prestacion`&&!k.trim()){G(`Seleccioná una prestación médica.`);return}let e=_({patientId:K.patientId,afiliadoId:K.afiliadoId,planNombre:K.planNombre,tipo:D,prestacionNombre:D===`prestacion`?k.trim():void 0,medicoId:j||void 0,medicoNombre:z,fecha:N||l(new Date,`yyyy-MM-dd`),observaciones:F.trim()||void 0,usuario:v?.displayName||v?.username||`Administración`});e.ok&&e.orden?U(e.orden):G(e.error||`No se pudo emitir la orden médica.`)}function ee(){U(null),G(null),O(`consulta`),A(``),M(``),P(l(new Date,`yyyy-MM-dd`)),I(``),t&&E(t)}return(0,w.jsxs)(w.Fragment,{children:[(0,w.jsx)(`div`,{className:`af-modal-backdrop`,role:`presentation`,onMouseDown:t=>{t.target===t.currentTarget&&e()},children:(0,w.jsxs)(`div`,{className:`af-modal af-modal-dialog`,style:{maxWidth:580,maxHeight:`92vh`,display:`flex`,flexDirection:`column`},role:`dialog`,"aria-modal":`true`,"aria-labelledby":`nueva-om-title`,children:[(0,w.jsxs)(`div`,{className:`af-modal__head`,style:{borderBottom:`1px solid var(--border)`},children:[(0,w.jsxs)(`div`,{children:[(0,w.jsx)(`h2`,{id:`nueva-om-title`,style:{margin:0,fontSize:`1.2rem`,color:`var(--heading)`},children:H?`Orden emitida`:`Nueva orden médica`}),(0,w.jsx)(`span`,{style:{fontSize:`0.8rem`,color:`#64748b`},children:H?`Comprobante oficial ${H.numero}`:`Emisión de órdenes para consultas y prácticas`})]}),(0,w.jsx)(`button`,{type:`button`,className:`af-btn af-btn--icon`,onClick:e,"aria-label":`Cerrar modal`,title:`Cerrar (Esc)`,children:`✕`})]}),W&&(0,w.jsx)(`div`,{style:{margin:`0.6rem 1.25rem 0`,padding:`0.5rem 0.75rem`,background:`#fef2f2`,border:`1px solid #fecaca`,color:`#b91c1c`,borderRadius:`6px`,fontSize:`0.82rem`,fontWeight:600},children:W}),(0,w.jsx)(`div`,{style:{flex:1,overflowY:`auto`,padding:`1.1rem 1.25rem`},children:H?(0,w.jsxs)(`div`,{style:{textAlign:`center`,padding:`1.2rem 0.5rem`},children:[(0,w.jsx)(`div`,{style:{width:58,height:58,borderRadius:`50%`,background:`#ecfdf5`,border:`2px solid #a7f3d0`,color:`#059669`,fontSize:`1.8rem`,display:`flex`,alignItems:`center`,justifyContent:`center`,margin:`0 auto 1rem`},"aria-hidden":`true`,children:`✓`}),(0,w.jsxs)(`h3`,{style:{fontSize:`1.3rem`,fontWeight:800,color:`#065f46`,margin:`0 0 0.35rem`},children:[`Orden `,H.numero,` emitida`]}),(0,w.jsx)(`p`,{style:{fontSize:`0.9rem`,color:`#475569`,marginBottom:`1.25rem`},children:`La orden fue registrada y numerada correlativamente en el sistema.`}),(0,w.jsxs)(`div`,{style:{background:`#f8fafc`,border:`1px solid #e2e8f0`,borderRadius:`8px`,padding:`0.9rem 1rem`,textAlign:`left`,fontSize:`0.86rem`,display:`flex`,flexDirection:`column`,gap:`0.45rem`,marginBottom:`1.5rem`},children:[(0,w.jsxs)(`div`,{children:[(0,w.jsx)(`span`,{style:{color:`#64748b`},children:`Contratante / Paciente: `}),(0,w.jsxs)(`strong`,{style:{color:`#0f172a`},children:[K?.apellido,`, `,K?.nombre]}),K?.dni&&(0,w.jsxs)(`span`,{style:{color:`#64748b`,fontSize:`0.8rem`},children:[` (DNI `,K.dni,`)`]})]}),(0,w.jsxs)(`div`,{children:[(0,w.jsx)(`span`,{style:{color:`#64748b`},children:`Cobertura: `}),(0,w.jsx)(`strong`,{style:{color:`#0284c7`},children:H.planNombre})]}),(0,w.jsxs)(`div`,{children:[(0,w.jsx)(`span`,{style:{color:`#64748b`},children:`Tipo: `}),(0,w.jsx)(`strong`,{children:H.tipo===`consulta`?`Consulta Médica`:`Prestación`}),H.tipo===`prestacion`&&H.prestacionNombre&&(0,w.jsxs)(`span`,{children:[` · `,H.prestacionNombre]})]}),H.medicoNombre&&(0,w.jsxs)(`div`,{children:[(0,w.jsx)(`span`,{style:{color:`#64748b`},children:`Pedido del médico: `}),(0,w.jsx)(`strong`,{style:{color:`#0f172a`},children:H.medicoNombre})]}),(0,w.jsxs)(`div`,{children:[(0,w.jsx)(`span`,{style:{color:`#64748b`},children:`Fecha: `}),(0,w.jsx)(`span`,{children:H.fecha})]}),H.observaciones&&(0,w.jsxs)(`div`,{children:[(0,w.jsx)(`span`,{style:{color:`#64748b`},children:`Observaciones: `}),(0,w.jsx)(`span`,{style:{fontStyle:`italic`},children:H.observaciones})]})]}),(0,w.jsxs)(`div`,{style:{display:`flex`,justifyContent:`center`,gap:`0.65rem`,flexWrap:`wrap`},children:[(0,w.jsx)(`button`,{type:`button`,className:`af-btn af-btn--primary`,style:{background:`#0891b2`,borderColor:`#0891b2`,color:`#ffffff`,fontWeight:700},onClick:Q,title:`Imprimir a la impresora predeterminada del sistema`,children:`Imprimir`}),(0,w.jsx)(`button`,{type:`button`,className:`af-btn`,style:{background:`#f0f9ff`,borderColor:`#bae6fd`,color:`#0284c7`},onClick:Z,title:`Ver PDF o descargar comprobante`,children:`Ver PDF`}),(0,w.jsx)(`button`,{type:`button`,className:`af-btn`,onClick:ee,children:`+ Nueva orden`}),(0,w.jsx)(`button`,{type:`button`,className:`af-btn`,style:{minWidth:80,justifyContent:`center`},onClick:e,children:`Salir`})]})]}):(0,w.jsxs)(`div`,{style:{display:`flex`,flexDirection:`column`,gap:`1rem`},children:[(0,w.jsxs)(`div`,{className:`af-field`,children:[(0,w.jsx)(`label`,{htmlFor:`om-afiliado`,children:`Contratante / Paciente`}),(0,w.jsxs)(`select`,{id:`om-afiliado`,className:`af-select`,value:S,onChange:e=>{E(e.target.value),W&&G(null)},children:[(0,w.jsx)(`option`,{value:``,children:`— Seleccionar contratante o adherente —`}),b.map(e=>(0,w.jsxs)(`option`,{value:e.patientId,children:[e.apellido,`, `,e.nombre,` `,e.dni?`· DNI ${e.dni}`:``,` `,e.esAdherente?`(${e.relacion||`Adherente`})`:`(Titular)`,` — `,e.planNombre,e.suspendido?` [SUSPENDIDO]`:``]},`${e.afiliadoId}_${e.patientId}`))]}),K?.suspendido&&(0,w.jsx)(`div`,{role:`alert`,style:{marginTop:`0.45rem`,padding:`0.45rem 0.7rem`,borderRadius:`6px`,background:`#f5f3ff`,border:`1px solid #c4b5fd`,color:`#5b21b6`,fontSize:`0.82rem`,fontWeight:700},children:`Contratante suspendido — No se pueden emitir órdenes médicas mientras dure la suspensión.`}),K&&q&&(0,w.jsxs)(`div`,{style:{marginTop:`0.4rem`,display:`flex`,alignItems:`center`,gap:`0.5rem`,flexWrap:`wrap`,fontSize:`0.78rem`},children:[(0,w.jsx)(`span`,{style:{background:`#e0f2fe`,color:`#0369a1`,padding:`0.15rem 0.5rem`,borderRadius:`6px`,fontWeight:700},children:K.planNombre}),(0,w.jsxs)(`span`,{style:{color:`#475569`,fontWeight:500},children:[`Consultas usadas: `,(0,w.jsx)(`strong`,{children:q.textoConsultas})]}),(q.plan.prestacionesPorMes??0)>0&&(0,w.jsxs)(`span`,{style:{color:`#475569`,fontWeight:500},children:[`· Prestaciones: `,(0,w.jsx)(`strong`,{children:q.textoPrestaciones})]})]})]}),(0,w.jsxs)(`div`,{className:`af-field`,children:[(0,w.jsx)(`label`,{children:`Tipo de orden`}),(0,w.jsxs)(`div`,{style:{display:`grid`,gridTemplateColumns:`1fr 1fr`,gap:`0.65rem`},children:[(0,w.jsxs)(`div`,{role:`button`,tabIndex:0,onClick:()=>O(`consulta`),onKeyDown:e=>{(e.key===`Enter`||e.key===` `)&&O(`consulta`)},style:{border:`2px solid ${D===`consulta`?`var(--primary)`:`#cbd5e1`}`,background:D===`consulta`?`#f0fdf4`:`#ffffff`,borderRadius:`8px`,padding:`0.65rem 0.8rem`,cursor:`pointer`,transition:`all 0.15s ease`},children:[(0,w.jsx)(`div`,{style:{fontWeight:700,fontSize:`0.9rem`,color:D===`consulta`?`#15803d`:`#334155`},children:`Consulta`}),(0,w.jsx)(`div`,{style:{fontSize:`0.74rem`,color:`#64748b`,marginTop:`0.15rem`},children:`Atención con el profesional`})]}),(0,w.jsxs)(`div`,{role:`button`,tabIndex:0,onClick:()=>O(`prestacion`),onKeyDown:e=>{(e.key===`Enter`||e.key===` `)&&O(`prestacion`)},style:{border:`2px solid ${D===`prestacion`?`var(--primary)`:`#cbd5e1`}`,background:D===`prestacion`?`#f0fdf4`:`#ffffff`,borderRadius:`8px`,padding:`0.65rem 0.8rem`,cursor:`pointer`,transition:`all 0.15s ease`},children:[(0,w.jsx)(`div`,{style:{fontWeight:700,fontSize:`0.9rem`,color:D===`prestacion`?`#15803d`:`#334155`},children:`Prestación`}),(0,w.jsx)(`div`,{style:{fontSize:`0.74rem`,color:`#64748b`,marginTop:`0.15rem`},children:`Estudio o práctica puntual`})]})]})]}),D===`prestacion`&&(0,w.jsxs)(`div`,{className:`af-field`,children:[(0,w.jsxs)(`div`,{style:{display:`flex`,alignItems:`center`,justifyContent:`space-between`,marginBottom:`0.2rem`},children:[(0,w.jsx)(`label`,{htmlFor:`om-prestacion`,style:{margin:0},children:`Prestación`}),(0,w.jsx)(`button`,{type:`button`,className:`af-btn af-btn--icon`,onClick:()=>V(!0),title:`Administrar prestaciones`,"aria-label":`Administrar prestaciones (engranaje)`,style:{padding:`0.2rem 0.35rem`,fontSize:`0.95rem`},children:`⚙️`})]}),(0,w.jsxs)(`select`,{id:`om-prestacion`,className:`af-select`,value:k,onChange:e=>{A(e.target.value),W&&G(null)},children:[(0,w.jsx)(`option`,{value:``,children:`— Elegir prestación —`}),[...J.entries()].map(([e,t])=>(0,w.jsx)(`optgroup`,{label:e,children:t.map(e=>(0,w.jsx)(`option`,{value:e.nombre,children:e.nombre},e.id))},e))]})]}),(0,w.jsxs)(`div`,{className:`af-field`,children:[(0,w.jsxs)(`label`,{htmlFor:`om-medico`,children:[`Pedido del Médico `,(0,w.jsx)(`span`,{style:{color:`#94a3b8`,fontWeight:400},children:`(opcional)`})]}),(0,w.jsxs)(`select`,{id:`om-medico`,className:`af-select`,value:j,onChange:e=>M(e.target.value),children:[(0,w.jsx)(`option`,{value:``,children:`— Seleccionar médico —`}),L.map(e=>{let t=e.apellido?`${e.apellido}, `:``,n=e.especialidad?` (${e.especialidad})`:``;return(0,w.jsxs)(`option`,{value:e.id,children:[t,e.nombre,n]},e.id)})]})]}),(0,w.jsxs)(`div`,{className:`af-field`,children:[(0,w.jsx)(`label`,{htmlFor:`om-fecha`,children:`Fecha`}),(0,w.jsx)(`input`,{id:`om-fecha`,className:`af-input`,type:`date`,value:N,onChange:e=>P(e.target.value)})]}),(0,w.jsxs)(`div`,{className:`af-field`,children:[(0,w.jsxs)(`label`,{htmlFor:`om-obs`,children:[`Observaciones `,(0,w.jsx)(`span`,{style:{color:`#94a3b8`,fontWeight:400},children:`(opcional)`})]}),(0,w.jsx)(`textarea`,{id:`om-obs`,className:`af-input af-textarea`,rows:3,style:{width:`100%`,boxSizing:`border-box`,minHeight:74,resize:`vertical`,padding:`0.55rem 0.75rem`,borderRadius:`8px`,border:`1px solid var(--border, #cbd5e1)`,fontSize:`0.88rem`,fontFamily:`inherit`,lineHeight:1.4},placeholder:`Diagnóstico presuntivo, indicaciones clínicas…`,value:F,onChange:e=>I(e.target.value)})]})]})}),!H&&(0,w.jsxs)(`div`,{style:{display:`flex`,alignItems:`center`,justifyContent:`center`,gap:`0.75rem`,padding:`1.25rem 1.25rem 1.35rem`,borderTop:`1px solid var(--border)`,background:`#ffffff`},children:[(0,w.jsx)(`button`,{type:`button`,className:`af-btn`,style:{minWidth:90,justifyContent:`center`},onClick:e,children:`Cancelar`}),(0,w.jsx)(`button`,{type:`button`,className:`af-btn`,style:{background:`#f0f9ff`,borderColor:`#bae6fd`,color:`#0284c7`,minWidth:80,justifyContent:`center`},disabled:!Y,onClick:Z,title:`Ver vista previa de la orden en PDF`,children:`PDF`}),(0,w.jsx)(`button`,{type:`button`,className:`af-btn af-btn--primary`,style:{minWidth:120,justifyContent:`center`,background:`#0891b2`,borderColor:`#0891b2`,color:`#ffffff`,fontWeight:600},disabled:!Y,onClick:$,children:`Emitir orden`}),(0,w.jsx)(`button`,{type:`button`,className:`af-btn`,style:{minWidth:80,justifyContent:`center`},onClick:e,children:`Salir`})]})]})}),B&&(0,w.jsx)(T,{onClose:()=>V(!1),prestacionSeleccionada:k,onPrestacionEliminada:e=>{o(k)===o(e)&&A(``)}})]})}export{E as t};