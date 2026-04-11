from __future__ import annotations

import csv
import io
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

DB_PATH = Path("data/app.db")
EXPORT_DIR = Path("data/exports")

DEFAULT_MAPPING: dict[str, list[str]] = {
    "full_name": ["full_name", "name", "Name"],
    "title": ["title", "job_title", "Title"],
    "company": ["company", "Company", "account_name"],
    "linkedin_url": ["linkedin_url", "profile_url", "LinkedIn URL"],
    "email": ["email", "Email"],
    "country": ["country", "Country"],
}

app = FastAPI(title="Lead List Manager", version="0.2.0")


class ImportResponse(BaseModel):
    import_id: int
    filename: str
    rows_received: int


class MappingRequest(BaseModel):
    mapping: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "Canonical target field to CSV header mapping, e.g. "
            "{\"full_name\": \"Name\", \"linkedin_url\": \"Profile URL\"}."
        ),
    )


class ProcessResponse(BaseModel):
    import_id: int
    rows_inserted: int
    rows_deduped: int


class ExportResponse(BaseModel):
    export_path: str
    rows_exported: int


class ImportDetails(BaseModel):
    import_id: int
    filename: str
    uploaded_at: str
    detected_headers: list[str]
    effective_mapping: dict[str, str]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS imports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                uploaded_at TEXT NOT NULL,
                headers_json TEXT NOT NULL,
                mapping_json TEXT
            );

            CREATE TABLE IF NOT EXISTS raw_rows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                import_id INTEGER NOT NULL,
                row_json TEXT NOT NULL,
                FOREIGN KEY(import_id) REFERENCES imports(id)
            );

            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                import_id INTEGER NOT NULL,
                full_name TEXT,
                title TEXT,
                company TEXT,
                linkedin_url TEXT,
                email TEXT,
                country TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(linkedin_url),
                UNIQUE(email)
            );
            """
        )


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "lead-list-manager"}


def _normalize_field(row: dict[str, Any], keys: list[str]) -> str:
    for key in keys:
        value = row.get(key)
        if value:
            return str(value).strip()
    return ""


def _build_effective_mapping(headers: list[str], mapping_json: str | None) -> dict[str, str]:
    if mapping_json:
        user_mapping = json.loads(mapping_json)
    else:
        user_mapping = {}

    effective: dict[str, str] = {}
    for canonical, aliases in DEFAULT_MAPPING.items():
        chosen = user_mapping.get(canonical)
        if chosen and chosen in headers:
            effective[canonical] = chosen
            continue

        matched = next((a for a in aliases if a in headers), "")
        effective[canonical] = matched
    return effective


@app.post("/imports", response_model=ImportResponse)
async def create_import(file: UploadFile = File(...)) -> ImportResponse:
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    content = await file.read()
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))

    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV file must contain header row")

    rows = list(reader)
    headers = [str(h).strip() for h in reader.fieldnames]

    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO imports(filename, uploaded_at, headers_json) VALUES (?, ?, ?)",
            (file.filename, utc_now_iso(), json.dumps(headers)),
        )
        import_id = int(cur.lastrowid)

        for row in rows:
            conn.execute(
                "INSERT INTO raw_rows(import_id, row_json) VALUES (?, ?)",
                (import_id, json.dumps(row, ensure_ascii=False)),
            )

    return ImportResponse(import_id=import_id, filename=file.filename, rows_received=len(rows))


@app.get("/imports/{import_id}", response_model=ImportDetails)
def get_import(import_id: int) -> ImportDetails:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, filename, uploaded_at, headers_json, mapping_json FROM imports WHERE id = ?",
            (import_id,),
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Import not found")

    headers = json.loads(row["headers_json"])
    effective_mapping = _build_effective_mapping(headers=headers, mapping_json=row["mapping_json"])

    return ImportDetails(
        import_id=row["id"],
        filename=row["filename"],
        uploaded_at=row["uploaded_at"],
        detected_headers=headers,
        effective_mapping=effective_mapping,
    )


@app.post("/imports/{import_id}/map", response_model=ImportDetails)
def set_mapping(import_id: int, req: MappingRequest) -> ImportDetails:
    with get_conn() as conn:
        row = conn.execute("SELECT headers_json FROM imports WHERE id = ?", (import_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Import not found")

        headers: list[str] = json.loads(row["headers_json"])

        for canonical, header in req.mapping.items():
            if canonical not in DEFAULT_MAPPING:
                raise HTTPException(status_code=400, detail=f"Unknown canonical field: {canonical}")
            if header and header not in headers:
                raise HTTPException(status_code=400, detail=f"Header not found in file: {header}")

        conn.execute(
            "UPDATE imports SET mapping_json = ? WHERE id = ?",
            (json.dumps(req.mapping, ensure_ascii=False), import_id),
        )

    return get_import(import_id)


@app.post("/imports/{import_id}/process", response_model=ProcessResponse)
def process_import(import_id: int) -> ProcessResponse:
    with get_conn() as conn:
        import_row = conn.execute(
            "SELECT headers_json, mapping_json FROM imports WHERE id = ?",
            (import_id,),
        ).fetchone()
        if not import_row:
            raise HTTPException(status_code=404, detail="Import not found")

        headers = json.loads(import_row["headers_json"])
        effective_mapping = _build_effective_mapping(headers=headers, mapping_json=import_row["mapping_json"])

        raw_rows = conn.execute("SELECT row_json FROM raw_rows WHERE import_id = ?", (import_id,)).fetchall()
        inserted = 0
        deduped = 0

        for raw in raw_rows:
            row = json.loads(raw["row_json"])

            full_name = _normalize_field(row, [effective_mapping.get("full_name", "")])
            title = _normalize_field(row, [effective_mapping.get("title", "")])
            company = _normalize_field(row, [effective_mapping.get("company", "")])
            linkedin_url = _normalize_field(row, [effective_mapping.get("linkedin_url", "")])
            email = _normalize_field(row, [effective_mapping.get("email", "")])
            country = _normalize_field(row, [effective_mapping.get("country", "")])

            try:
                conn.execute(
                    """
                    INSERT INTO leads(
                        import_id, full_name, title, company, linkedin_url, email, country, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        import_id,
                        full_name or None,
                        title or None,
                        company or None,
                        linkedin_url or None,
                        email or None,
                        country or None,
                        utc_now_iso(),
                    ),
                )
                inserted += 1
            except sqlite3.IntegrityError:
                deduped += 1

    return ProcessResponse(import_id=import_id, rows_inserted=inserted, rows_deduped=deduped)


@app.get("/leads")
def list_leads(
    country: str | None = Query(default=None),
    company: str | None = Query(default=None),
    title_keyword: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    query = "SELECT id, full_name, title, company, linkedin_url, email, country, created_at FROM leads WHERE 1=1"
    params: list[Any] = []

    if country:
        query += " AND country = ?"
        params.append(country)
    if company:
        query += " AND company LIKE ?"
        params.append(f"%{company}%")
    if title_keyword:
        query += " AND title LIKE ?"
        params.append(f"%{title_keyword}%")

    with get_conn() as conn:
        rows = conn.execute(query, params).fetchall()

    return [dict(row) for row in rows]


@app.post("/exports", response_model=ExportResponse)
def export_leads() -> ExportResponse:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT full_name, title, company, linkedin_url, email, country FROM leads ORDER BY id"
        ).fetchall()

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_path = EXPORT_DIR / f"leads_{ts}.csv"

    with open(out_path, "w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["full_name", "title", "company", "linkedin_url", "email", "country"])
        for row in rows:
            writer.writerow(
                [
                    row["full_name"],
                    row["title"],
                    row["company"],
                    row["linkedin_url"],
                    row["email"],
                    row["country"],
                ]
            )

    return ExportResponse(export_path=str(out_path), rows_exported=len(rows))


@app.get("/exports/latest")
def download_latest_export() -> FileResponse:
    files = sorted(EXPORT_DIR.glob("leads_*.csv"))
    if not files:
        raise HTTPException(status_code=404, detail="No exports found")
    latest = files[-1]
    return FileResponse(path=latest, media_type="text/csv", filename=latest.name)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=True)
