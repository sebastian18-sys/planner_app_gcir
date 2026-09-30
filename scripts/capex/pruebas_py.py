# Exec in MV 10.30.17.57
import sys, os
# sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'vendor'))
HERE = os.path.dirname(__file__)
PARENT = os.path.abspath(os.path.join(HERE, os.pardir))
VENDOR = os.path.join(PARENT, 'vendor')

sys.path.insert(0, VENDOR)
#######

import pandas as pd
import numpy as np
import datetime
from matplotlib import pyplot as plt
from openpyxl import load_workbook
from openpyxl.utils.dataframe import dataframe_to_rows
from openpyxl.styles import numbers
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.utils import get_column_letter
import xlwings as xw
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from xlsx2csv import Xlsx2csv
import os, json, time, traceback

# Ruta base = carpeta donde está este script
BASE_DIR = Path(__file__).resolve().parent
CACHE_DIR = BASE_DIR / ".cache_xlsx_csv"
SHEET_ID = 1
os.makedirs(CACHE_DIR, exist_ok=True)

# ---------------- Helpers cache ----------------
def _cache_paths(xlsx_path):
    base = os.path.basename(xlsx_path)
    name = "{}__sheet{}.csv".format(os.path.splitext(base)[0], SHEET_ID)
    csv_path  = str(CACHE_DIR / name)
    meta_path = csv_path + ".meta.json"
    return csv_path, meta_path

def _needs_refresh(xlsx_path, csv_path, meta_path):
    if not os.path.exists(csv_path) or not os.path.exists(meta_path):
        return True
    try:
        st = os.stat(xlsx_path)
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        return not (meta.get("size") == st.st_size and meta.get("mtime") == st.st_mtime)
    except Exception:
        return True

def _save_meta(xlsx_path, meta_path):
    st = os.stat(xlsx_path)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({"size": st.st_size, "mtime": st.st_mtime}, f)

def convert_xlsx_to_csv_if_needed(xlsx_path):
    csv_path, meta_path = _cache_paths(xlsx_path)
    if _needs_refresh(xlsx_path, csv_path, meta_path):
        Xlsx2csv(str(xlsx_path), outputencoding="utf-8", sheetid=SHEET_ID).convert(csv_path)
        _save_meta(xlsx_path, meta_path)
    return csv_path

def read_as_csv(xlsx_path, skiprows=None):
    csv_path = convert_xlsx_to_csv_if_needed(xlsx_path)
    return pd.read_csv(csv_path, skiprows=skiprows)

def read_as_excel(xlsx_path, skiprows=None):
    return pd.read_excel(str(xlsx_path), skiprows=skiprows, engine="openpyxl")

# ---------------- Workers ----------------
def worker_csv(args):
    path, skip = args
    t0 = time.perf_counter()
    try:
        df = read_as_csv(path, skip)
        return (path, df, time.perf_counter() - t0, None)
    except Exception:
        return (path, None, time.perf_counter() - t0, traceback.format_exc())

def worker_excel(args):
    path, skip = args
    t0 = time.perf_counter()
    try:
        df = read_as_excel(path, skip)
        return (path, df, time.perf_counter() - t0, None)
    except Exception:
        return (path, None, time.perf_counter() - t0, traceback.format_exc())

def load_group_process(files, csv=True, max_workers=None):
    worker = worker_csv if csv else worker_excel
    results = []
    with ProcessPoolExecutor(max_workers=max_workers) as ex:
        futs = [ex.submit(worker, f) for f in files]
        for fut in as_completed(futs):
            path, df, dt, err = fut.result()
            if err:
                print("ERROR en:", path, "\n", err)
            else:
                results.append((path, df, dt))
    order = {p:i for i,(p,_) in enumerate(files)}
    results.sort(key=lambda t: order[t[0]])
    return pd.concat([d for _,d,_ in results], ignore_index=True)

# ---------------- Main ----------------
if __name__ == "__main__":
    # Definición de ficheros (rutas relativas a BASE_DIR)
    files_rq = [
        (BASE_DIR / 'TS 03.10 Historico de RQs - Nuevas Columnas v2_Reporte Excel 1.0 (2022).xlsx', 7), 
        (BASE_DIR / 'TS 03.10 Historico de RQs - Nuevas Columnas v2_Reporte Excel 1.0 (2023).xlsx', 7), 
        (BASE_DIR / 'TS 03.10 Historico de RQs - Nuevas Columnas v2_Reporte Excel 1.0 (2024) 1508.xlsx', 7)
    ]

    files_oc = [
        (BASE_DIR / 'TS 03.15 Orden de Compra_Reporte Excel 1.0 (2022).xlsx', 7),
        (BASE_DIR / 'TS 03.15 Orden de Compra_Reporte Excel 1.0 (2023).xlsx', 7),
        (BASE_DIR / 'TS 03.15 Orden de Compra_Reporte Excel 1.0 (Ene_Sep24) 1508.xlsx', 7)
    ]

    files_cr = [
        (BASE_DIR / 'TS 03.16 Códigos Recepción - Nuevas Columnas_Reporte (2022).xlsx', 7), 
        (BASE_DIR / 'TS 03.16 Códigos Recepción - Nuevas Columnas_Reporte (2023).xlsx', 7), 
        (BASE_DIR / 'TS 03.16 Códigos Recepción - Nuevas Columnas_Reporte (2024) 1508.xlsx', 7)
    ]

    files_misc = [
        (BASE_DIR / 'FCST 2025.xlsx', None),
        (BASE_DIR / 'Proyectos capex 2025 0808.xlsx', 2),
        (BASE_DIR / 'GCIR - Master Plan 2025 - General.xlsm', 2),
        (BASE_DIR / 'TS 03.15 Orden de Compra_Reporte Excel 1.0 (2024) CIERRE.xlsx', 7),
        (BASE_DIR / 'Provision 2024.xlsx', None)
    ]

    t_total = time.perf_counter()

    # Convertir primero los que van a CSV
    for p,_ in (files_rq + files_oc + files_cr):
        try:
            convert_xlsx_to_csv_if_needed(p)
        except Exception:
            traceback.print_exc()

    t0 = time.perf_counter()
    matriz_rq    = load_group_process(files_rq, csv=True)
    print("⏱ Tiempo RQ: {:.2f}s".format(time.perf_counter() - t0))

    t0 = time.perf_counter()
    matriz_oc_ac = load_group_process(files_oc, csv=True)
    print("⏱ Tiempo OC: {:.2f}s".format(time.perf_counter() - t0))

    t0 = time.perf_counter()
    matriz_cr    = load_group_process(files_cr, csv=True)
    print("⏱ Tiempo CR: {:.2f}s".format(time.perf_counter() - t0))

    t0 = time.perf_counter()
    misc_dfs = [read_as_excel(p, s) for (p,s) in files_misc]
    matriz_fcst, matriz_solpe, matriz_mp, matriz_oc_cierre, matriz_provision = misc_dfs
    print("⏱ Tiempo MISC: {:.2f}s".format(time.perf_counter() - t0))

    print("⏱ Tiempo TOTAL: {:.2f}s".format(time.perf_counter() - t_total))