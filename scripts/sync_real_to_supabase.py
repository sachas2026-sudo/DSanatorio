import sqlite3
import json
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

con = sqlite3.connect('file:C:/Sanatorio/datos/sanatorio-datos.db?mode=ro', uri=True)
cur = con.cursor()

# Get doctors
docs = {}
for r in cur.execute('SELECT id, apellido, nombre, especialidad, porcentaje FROM doctors').fetchall():
    ap = (r[1] or '').strip()
    nom = (r[2] or '').strip()
    nombre = f'{ap}, {nom}' if (ap and nom) else (ap or nom or 'Médico')
    docs[r[0]] = {'nombre': nombre, 'especialidad': (r[3] or '').strip(), 'porcentaje': r[4] or 30.0}

patients_os = {}
for r in cur.execute('SELECT id, obra_social FROM patients').fetchall():
    patients_os[r[0]] = (r[1] or '').strip()

afiliados_pacientes = set()
afiliado_plan_por_paciente = {}
for r in cur.execute('SELECT data FROM afiliados').fetchall():
    try:
        d = json.loads(r[0])
        if d.get('activo', True) is not False:
            if d.get('patientId'):
                afiliados_pacientes.add(d.get('patientId'))
                afiliado_plan_por_paciente[d.get('patientId')] = d.get('planId')
            for adh in d.get('adherentes') or []:
                if isinstance(adh, dict) and adh.get('patientId'):
                    afiliados_pacientes.add(adh.get('patientId'))
                    afiliado_plan_por_paciente[adh.get('patientId')] = d.get('planId')
    except Exception:
        pass

# Mapa planId -> tipo (individual/familiar)
plan_tipo_por_id = {}
for r in cur.execute('SELECT id, data FROM planes_afiliados').fetchall():
    try:
        d = json.loads(r[1]) if r[1] else {}
        plan_tipo_por_id[r[0]] = (d.get('tipo') or '').strip().lower()
    except Exception:
        pass

plan_nombres = {
    'plan estándar',
    'plan estandar',
    'plan plus',
    'plan ultra',
    'familiar',
    'individual',
    'plan familiar',
    'plan individual',
}
for r in cur.execute('SELECT id, nombre, data FROM planes_afiliados').fetchall():
    try:
        d = json.loads(r[2]) if r[2] else {}
        n = (r[1] or d.get('nombre', '')).strip().lower()
        if n:
            plan_nombres.add(n)
    except Exception:
        pass

def a_local(s):
    d = datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone()

hoy = datetime.now()
ant = (hoy.replace(day=1) - timedelta(days=1)).replace(day=1)
desde = ant.strftime('%Y-%m-%d')

all_payments = {}
for r in cur.execute('SELECT id, doctor_id, monto, metodo, porcentaje_aplicado, fecha, cita_id, patient_id FROM payments').fetchall():
    try:
        loc = a_local(r[5])
    except Exception:
        continue
    all_payments.setdefault(loc.strftime('%Y-%m-%d'), []).append(r[:5] + (loc.strftime('%Y-%m-%dT%H:%M:%S'), r[6], r[7]))

all_appts = {}
for r in cur.execute('SELECT id, estado, doctor_id, fecha_hora, patient_id, obra_social_override FROM appointments').fetchall():
    try:
        loc = a_local(r[3])
    except Exception:
        continue
    all_appts.setdefault(loc.strftime('%Y-%m-%d'), []).append((r[0], r[1], r[2], r[4], r[5]))

dates = sorted({d for d in list(all_payments) + list(all_appts) if d >= desde}, reverse=True)
hoy_str = hoy.strftime('%Y-%m-%d')
if hoy_str not in dates:
    dates.insert(0, hoy_str)

SUPABASE_URL = 'https://mzfyzabgdlzqkvufqrxh.supabase.co'
SERVICE_KEY = 'sb_secret_4HAhss-rRoYWNVg9ui1haQ_v1vywr4_'

payloads = []
for d in dates:
    payments = all_payments.get(d, [])
    appts = all_appts.get(d, [])
    
    total_cobrado = 0.0
    total_efectivo = 0.0
    total_transferencia = 0.0
    total_otros = 0.0
    rec_manana = 0.0
    rec_tarde = 0.0
    
    medicos_map = {}
    paid_citas_by_doc = {}
    paid_pats_by_doc = {}
    
    for p in payments:
        monto = float(p[2] or 0)
        total_cobrado += monto
        metodo = (p[3] or '').lower()
        if 'transf' in metodo:
            total_transferencia += monto
        elif 'efectivo' in metodo:
            total_efectivo += monto
        else:
            total_otros += monto
            
        try:
            h = int(p[5][11:13]) if len(p[5]) >= 13 else 10
            if h < 14:
                rec_manana += monto
            else:
                rec_tarde += monto
        except:
            rec_manana += monto
            
        doc_id = p[1]
        doc_info = docs.get(doc_id, {'nombre': 'Médico', 'especialidad': '', 'porcentaje': 30.0})
        pct_centro = float(p[4] if p[4] is not None else doc_info['porcentaje'])
        centro_item = round(monto * (pct_centro / 100.0), 2)
        medico_item = round(monto - centro_item, 2)
        
        m_item = medicos_map.get(doc_id, {
            'id': doc_id,
            'nombre': doc_info['nombre'],
            'especialidad': doc_info['especialidad'],
            'pacientes': 0,
            'totalCobrado': 0.0,
            'totalCentro': 0.0,
            'totalMedico': 0.0,
            'monto': 0.0
        })
        m_item['pacientes'] += 1
        m_item['totalCobrado'] += monto
        m_item['totalCentro'] += centro_item
        m_item['totalMedico'] += medico_item
        m_item['monto'] += medico_item
        medicos_map[doc_id] = m_item
        if len(p) > 6 and p[6]:
            paid_citas_by_doc.setdefault(doc_id, set()).add(p[6])
        if len(p) > 7 and p[7]:
            paid_pats_by_doc.setdefault(doc_id, set()).add(p[7])

    # Sumar también turnos activos que no pagaron plus/abono a los pacientes del médico
    for a in appts:
        estado = (a[1] or '').lower().strip()
        if estado == 'cancelado':
            continue
        appt_id, doc_id, pat_id = a[0], a[2], a[3]
        if appt_id in paid_citas_by_doc.get(doc_id, set()) or pat_id in paid_pats_by_doc.get(doc_id, set()):
            continue
        doc_info = docs.get(doc_id, {'nombre': 'Médico', 'especialidad': '', 'porcentaje': 30.0})
        m_item = medicos_map.get(doc_id, {
            'id': doc_id,
            'nombre': doc_info['nombre'],
            'especialidad': doc_info['especialidad'],
            'pacientes': 0,
            'totalCobrado': 0.0,
            'totalCentro': 0.0,
            'totalMedico': 0.0,
            'monto': 0.0
        })
        m_item['pacientes'] += 1
        medicos_map[doc_id] = m_item

    medicos_detalle = sorted(medicos_map.values(), key=lambda x: (x['monto'], x['pacientes']), reverse=True)
    total_centro = sum(m['totalCentro'] for m in medicos_detalle)
    total_medicos = sum(m['totalMedico'] for m in medicos_detalle)
    
    clasificacion = {
        'atendidos': {'obra_social': 0, 'individual': 0, 'familiar': 0, 'plan_plus': 0, 'particular': 0},
        'pendientes': {'obra_social': 0, 'individual': 0, 'familiar': 0, 'plan_plus': 0, 'particular': 0},
        'cancelados': {'obra_social': 0, 'individual': 0, 'familiar': 0, 'plan_plus': 0, 'particular': 0},
    }
    
    for a in appts:
        estado = (a[1] or '').lower().strip()
        if estado == 'cancelado':
            st = 'cancelados'
        elif estado == 'atendido':
            st = 'atendidos'
        else:
            st = 'pendientes'
            
        pat_id = a[3]
        os_override = (a[4] or '').strip()
        os_override_norm = os_override.lower()
        pat_os = (patients_os.get(pat_id) or '').strip()
        pat_os_norm = pat_os.lower()
        is_afiliado = pat_id in afiliados_pacientes
        
        if os_override_norm == 'particular':
            cat = 'particular'
        elif is_afiliado:
            pid = afiliado_plan_por_paciente.get(pat_id)
            tipo = (plan_tipo_por_id.get(pid) or '').lower() if pid else ''
            if tipo == 'individual':
                cat = 'individual'
            elif tipo == 'familiar':
                cat = 'familiar'
            else:
                cat = 'plan_plus'
        elif os_override and os_override_norm in plan_nombres:
            if os_override_norm in ('individual', 'plan individual'):
                cat = 'individual'
            elif os_override_norm in ('familiar', 'plan familiar'):
                cat = 'familiar'
            else:
                cat = 'plan_plus'
        elif (not os_override) and pat_os and pat_os_norm in plan_nombres:
            if pat_os_norm in ('individual', 'plan individual'):
                cat = 'individual'
            elif pat_os_norm in ('familiar', 'plan familiar'):
                cat = 'familiar'
            else:
                cat = 'plan_plus'
        elif os_override:
            cat = 'obra_social'
        elif pat_os and pat_os_norm not in ('particular', 'ninguno', 'ninguna', 'sin obra social', 'no tiene', '-'):
            cat = 'obra_social'
        else:
            cat = 'particular'
            
        clasificacion[st][cat] += 1
        
    turnos_atendidos = sum(clasificacion['atendidos'].values())
    turnos_pendientes = sum(clasificacion['pendientes'].values())
    turnos_cancelados = sum(clasificacion['cancelados'].values())
    turnos_totales = turnos_atendidos + turnos_pendientes + turnos_cancelados
        
    payload = {
        'fecha': d,
        'total_cobrado': round(total_cobrado, 2),
        'total_centro': round(total_centro, 2),
        'total_medicos': round(total_medicos, 2),
        'total_efectivo': round(total_efectivo, 2),
        'total_transferencia': round(total_transferencia, 2),
        'total_otros': round(total_otros, 2),
        'turnos_totales': turnos_totales,
        'turnos_atendidos': turnos_atendidos,
        'turnos_cancelados': turnos_cancelados,
        'turnos_pendientes': turnos_pendientes,
        'turnos_clasificacion': clasificacion,
        'recaudacion_manana': round(rec_manana, 2),
        'recaudacion_tarde': round(rec_tarde, 2),
        'recaudacion_mary': round(rec_manana, 2),
        'recaudacion_andrea': round(rec_tarde, 2),
        'medicos_detalle': medicos_detalle,
        'ultima_actualizacion': datetime.now().astimezone().isoformat(),
        'origen': 'Sanatorio Desktop|' + json.dumps(clasificacion)
    }
    payloads.append(payload)

print(f'Subiendo {len(payloads)} días a Supabase...')
has_column_turnos_clasificacion = True

for p in payloads:
    p_copy = dict(p)
    if not has_column_turnos_clasificacion:
        p_copy.pop('turnos_clasificacion', None)
        
    body = json.dumps(p_copy).encode('utf-8')
    req = urllib.request.Request(
        f'{SUPABASE_URL}/rest/v1/resumen_diario?on_conflict=fecha',
        data=body,
        headers={
            'apikey': SERVICE_KEY,
            'Authorization': f'Bearer {SERVICE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=representation'
        },
        method='POST'
    )
    try:
        with urllib.request.urlopen(req) as resp:
            print(f'✓ Subido {p["fecha"]}: Cobrado ${p["total_cobrado"]} (Turnos: {p["turnos_totales"]})')
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode('utf-8')
        if 'turnos_clasificacion' in err_msg:
            # La columna no existe en Supabase, reintentar sin la columna
            has_column_turnos_clasificacion = False
            p_copy.pop('turnos_clasificacion', None)
            body2 = json.dumps(p_copy).encode('utf-8')
            req2 = urllib.request.Request(
                f'{SUPABASE_URL}/rest/v1/resumen_diario?on_conflict=fecha',
                data=body2,
                headers={
                    'apikey': SERVICE_KEY,
                    'Authorization': f'Bearer {SERVICE_KEY}',
                    'Content-Type': 'application/json',
                    'Prefer': 'resolution=merge-duplicates,return=representation'
                },
                method='POST'
            )
            try:
                with urllib.request.urlopen(req2) as resp2:
                    print(f'✓ Subido {p["fecha"]} (con clasif en origen): Cobrado ${p["total_cobrado"]} (Turnos: {p["turnos_totales"]})')
            except Exception as e2:
                print(f'✗ Error al reintentar {p["fecha"]}: {e2}')
        else:
            print(f'✗ Error al subir {p["fecha"]}: {err_msg}')
    except Exception as e:
        print(f'✗ Excepción al subir {p["fecha"]}: {e}')

print('\nSubiendo directorio de médicos a Supabase...')
medicos_rows = []
for r in cur.execute('SELECT id, apellido, nombre, especialidad, porcentaje, activo FROM doctors').fetchall():
    ap = (r[1] or '').strip()
    nom = (r[2] or '').strip()
    nombre_med = f'{ap}, {nom}' if ap and nom else (ap or nom)
    retencion = float(r[4] or 0.0)
    pct_med = max(0.0, min(100.0, round(100.0 - retencion, 2)))
    activo = bool(r[5] if r[5] is not None else 1)
    medicos_rows.append({
        'medico_id': str(r[0]),
        'nombre': nombre_med,
        'especialidad': (r[3] or '').strip() or 'Sin especialidad',
        'porcentaje_medico': pct_med,
        'activo': activo,
        'ultima_actualizacion': datetime.now().astimezone().isoformat()
    })

agenda_por_fecha = {}
for fecha_key, appts_list in all_appts.items():
    if fecha_key < desde:
        continue
    doc_counts = {}
    for a in appts_list:
        estado = (a[1] or '').lower().strip()
        if estado == 'cancelado':
            continue
        doc_id = a[2]
        doc_info = docs.get(doc_id, {'nombre': 'Médico', 'especialidad': ''})
        item = doc_counts.get(doc_id, {
            'id': doc_id,
            'nombre': doc_info['nombre'],
            'especialidad': doc_info['especialidad'],
            'pacientes': 0,
        })
        item['pacientes'] += 1
        doc_counts[doc_id] = item
    if doc_counts:
        agenda_por_fecha[fecha_key] = sorted(
            doc_counts.values(),
            key=lambda x: x['pacientes'],
            reverse=True,
        )

medicos_rows.append({
    'medico_id': '__agenda_turnos_por_fecha__',
    'nombre': '__AGENDA__',
    'especialidad': json.dumps(agenda_por_fecha, ensure_ascii=False),
    'porcentaje_medico': 0.0,
    'activo': False,
    'ultima_actualizacion': datetime.now().astimezone().isoformat(),
})

req_med = urllib.request.Request(
    f'{SUPABASE_URL}/rest/v1/medicos_directorio?on_conflict=medico_id',
    data=json.dumps(medicos_rows).encode('utf-8'),
    headers={
        'apikey': SERVICE_KEY,
        'Authorization': f'Bearer {SERVICE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
    },
    method='POST'
)
try:
    with urllib.request.urlopen(req_med) as resp:
        print(f'✓ Directorio de {len(medicos_rows)} médicos subido con éxito!')
except Exception as e:
    print(f'Aviso al subir directorio de médicos: {e}')

print('¡Sincronización con Supabase finalizada con éxito!')
