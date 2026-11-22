"""Exportación XLSX autocontenida de datos propios de AgroConecta.

No requiere librerías de Excel ni acepta fórmulas proporcionadas por usuarios.
Todas las celdas de texto son inline strings de OOXML.
"""
from __future__ import annotations

from datetime import datetime
from io import BytesIO
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo
from zipfile import ZipFile, ZIP_DEFLATED

PERU = ZoneInfo('America/Lima')


def peru_day(value: str) -> str:
    try:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if dt.tzinfo is None:
            return str(value)[:10]
        return dt.astimezone(PERU).date().isoformat()
    except (ValueError, TypeError):
        return str(value)[:10]


def filtered_records(farm, owner: str, start='', end='', plot_id='', status='', q=''):
    plots = farm.list(owner, 'plots')
    plots_by_id = {p['id']: p.get('name', 'Parcela') for p in plots}
    def relevant_date(value):
        return (not start or value >= start) and (not end or value <= end)
    query = q.strip().casefold()
    def match(*values):
        return not query or any(query in str(v or '').casefold() for v in values)
    tasks = [a for a in farm.list(owner, 'activities')
             if relevant_date(a.get('date', '')) and (not plot_id or a.get('plot_id') == plot_id)
             and (not status or a.get('status') == status)
             and match(a.get('title'), a.get('category'), a.get('status'), a.get('notes'), plots_by_id.get(a.get('plot_id')))]
    harvests = [h for h in farm.list(owner, 'harvests')
                if relevant_date(h.get('date','')) and (not plot_id or h.get('plot_id') == plot_id)
                and match(h.get('code'), h.get('stage'), h.get('notes'), plots_by_id.get(h.get('plot_id')))]
    all_tasks = farm.list(owner, 'activities')
    all_harvests = farm.list(owner, 'harvests')
    related = {r['id']: r.get('plot_id') for r in all_tasks + all_harvests}
    events = [e for e in farm.history(owner)
              if relevant_date(peru_day(e.get('date', '')))
              and (not plot_id or e.get('plot_id') == plot_id
                   or (e.get('kind') == 'plots' and e.get('record_id') == plot_id)
                   or related.get(e.get('record_id')) == plot_id)
              and match(e.get('label'), e.get('kind'), e.get('action'))]
    return tasks, harvests, events, plots_by_id


def col_name(index):
    out = ''
    while index:
        index, digit = divmod(index - 1, 26)
        out = chr(65 + digit) + out
    return out


def xml_text(value):
    # XML 1.0 accepts tabs, LF, CR, printable code points only.
    value = ''.join(ch for ch in str(value if value is not None else '')
                    if ch in '\t\n\r' or ord(ch) >= 32)
    return escape(value, {'"': '&quot;', "'": '&apos;'})


def sheet_xml(rows, widths=None):
    rows = list(rows)
    cols = max((len(row) for row in rows), default=1)
    widths = widths or [22] * cols
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
           '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
           '<sheetFormatPr defaultRowHeight="19"/><cols>']
    for i in range(cols):
        out.append(f'<col min="{i+1}" max="{i+1}" width="{widths[i] if i < len(widths) else 22}" customWidth="1"/>')
    out.append('</cols><sheetData>')
    for n, row in enumerate(rows, start=1):
        out.append(f'<row r="{n}" ht="{27 if n == 1 else 20}" customHeight="1">')
        for j, value in enumerate(row, start=1):
            ref = f'{col_name(j)}{n}'
            style = 1 if n == 1 else (2 if n % 2 == 0 else 0)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                out.append(f'<c r="{ref}" s="{style}" t="n"><v>{value}</v></c>')
            else:
                out.append(f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{xml_text(value)}</t></is></c>')
        out.append('</row>')
    out.append('</sheetData>')
    if len(rows) > 1:
        out.append(f'<autoFilter ref="A1:{col_name(cols)}{len(rows)}"/>')
    out.append('</worksheet>')
    return ''.join(out).encode('utf-8')


def make_report(farm, owner, start='', end='', plot_id='', status='', q=''):
    tasks, harvests, events, plots = filtered_records(farm, owner, start, end, plot_id, status, q)
    total = sum(float(h.get('quantity') or 0) for h in harvests)
    remaining = sum(float(h.get('current_quantity') or 0) for h in harvests)
    completed = sum(a.get('status') == 'Completada' for a in tasks)
    filters = f"Del {start or 'inicio'} al {end or 'hoy'} · {plots.get(plot_id, 'Todas las parcelas') if plot_id else 'Todas las parcelas'}"
    sheets = [
        ('Resumen', [
            ['INDICADOR', 'VALOR'],
            ['Reporte', 'AgroConecta · Historial y reportes'],
            ['Período / parcela', filters],
            ['Filtro de estado', status or 'Todos'],
            ['Búsqueda', q or 'Sin búsqueda'],
            ['Cosecha registrada (kg)', round(total, 2)],
            ['Cantidad actual registrada (kg)', round(remaining, 2)],
            ['Lotes registrados', len(harvests)],
            ['Actividades registradas', len(tasks)],
            ['Actividades completadas', completed],
            ['Eventos de historial', len(events)],
        ], [38, 60]),
        ('Actividades', [['ACTIVIDAD', 'PARCELA', 'FECHA PLANIFICADA', 'CATEGORÍA', 'ESTADO', 'OBSERVACIONES'],
                       *[[a.get('title',''), plots.get(a.get('plot_id'), 'Parcela'), a.get('date',''), a.get('category',''),a.get('status',''),a.get('notes','')] for a in tasks]], [36, 30, 21, 20, 18, 55]),
        ('Cosechas', [['LOTE', 'PARCELA', 'FECHA COSECHA', 'KG INICIALES', 'KG ACTUALES', 'ETAPA', 'OBSERVACIONES'],
                    *[[h.get('code',''),plots.get(h.get('plot_id'),'Parcela'),h.get('date',''), float(h.get('quantity') or 0),float(h.get('current_quantity') or 0),h.get('stage',''),h.get('notes','')] for h in harvests]], [20, 30, 21, 19, 19, 28, 55]),
        ('Historial', [['FECHA (PERÚ)', 'REGISTRO', 'TIPO', 'ACCIÓN'],
                     *[[peru_day(e.get('date','')),e.get('label',''),e.get('kind',''),e.get('action','')] for e in events]], [21, 42, 19, 25]),
    ]
    wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    for i, (name, _, _) in enumerate(sheets, 1):
        wb += f'<sheet name="{name}" sheetId="{i}" r:id="rId{i}"/>'
    wb += '</sheets></workbook>'
    rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    for i in range(len(sheets)):
        rels += f'<Relationship Id="rId{i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i+1}.xml"/>'
    rels += '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
    styles = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Aptos"/><color rgb="FF213C2C"/></font><font><b/><sz val="11"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF234A35"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F5ED"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'''
    types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    for i in range(len(sheets)):
        types += f'<Override PartName="/xl/worksheets/sheet{i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    types += '</Types>'
    root = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    bio = BytesIO()
    with ZipFile(bio, 'w', ZIP_DEFLATED) as z:
        for name, contents in [('[Content_Types].xml', types),('_rels/.rels', root),('xl/workbook.xml',wb),('xl/_rels/workbook.xml.rels',rels),('xl/styles.xml',styles)]:
            z.writestr(name, contents)
        for i, (_, rows, widths) in enumerate(sheets, 1):
            z.writestr(f'xl/worksheets/sheet{i}.xml', sheet_xml(rows,widths))
    return bio.getvalue()
