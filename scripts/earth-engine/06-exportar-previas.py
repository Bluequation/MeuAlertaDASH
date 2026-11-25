#!/usr/bin/env python3
"""
CUIDAÍ | Água — exportar PRÉVIAS REAIS de cenas no Google Earth Engine.

Executar em ambiente já autenticado no projeto GCP 'cuidai-agua':
    pip install earthengine-api pillow requests
    python scripts/earth-engine/06-exportar-previas.py --project cuidai-agua

Saídas:
    public/data/agua/previas/<scene_id>.webp
    public/data/cuidai-agua-sao-jose-iii-previas.json

As prévias RGB mostram a imagem original na região de referência do açude,
NÃO a máscara NDWI nem os hectares calculados dentro da AOI. Elas servem para
inspecionar nuvens, turvação e bordas; não validam sozinhas as estimativas.

As URLs temporárias emitidas pelo Earth Engine são baixadas IMEDIATAMENTE e
convertidas em WebP para publicação estável. Nunca publicar tokens/credenciais.

MapBiomas: com --geometry arquivo.geojson pode-se exportar mapas ANUAIS
classe 1 sobre o AOI original. Sem essa geometria, o programa não tenta
improvisar um polígono ou representar o mapa anual.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import ee
    import requests
    from PIL import Image
except ImportError:
    raise SystemExit("Instale as dependências: pip install earthengine-api pillow requests")

ROOT = Path(__file__).resolve().parents[2]
CSV_CENAS = ROOT / "public/data/cuidai-agua-sao-jose-iii-cenas-2023-2026.csv"
CSV_MAPBIOMAS = ROOT / "public/data/cuidai-agua-sao-jose-iii-mapbiomas.csv"
DESTINO = ROOT / "public/data/agua/previas"
MANIFESTO = ROOT / "public/data/cuidai-agua-sao-jose-iii-previas.json"
MAPBIOMAS_ASSET = (
    "projects/mapbiomas-public/assets/brazil/water/collection5/"
    "mapbiomas_brazil_collection5_water_annual_v4"
)
PONTO = [-40.7703, -4.8986]


def nome_arquivo(chave: str) -> str:
    seguro = re.sub(r"[^a-zA-Z0-9_.-]", "_", chave)
    if not seguro or seguro in {".", ".."}:
        raise ValueError(f"Identificador de cena inválido: {chave!r}")
    return seguro + ".webp"


def imagem_rgb(sensor: str, cena_id: str):
    if sensor == "Sentinel-2":
        imagem = ee.Image("COPERNICUS/S2_SR_HARMONIZED/" + cena_id)
        return imagem.visualize(
            bands=["B4", "B3", "B2"], min=100, max=3500, gamma=1.15
        )
    if sensor == "Landsat":
        prefixo = cena_id[:4]
        if prefixo not in ("LC08", "LC09"):
            raise ValueError(f"Identificador Landsat não suportado: {cena_id}")
        imagem = ee.Image(f"LANDSAT/{prefixo}/C02/T1_L2/{cena_id}")
        reflectancias = (
            imagem.select(["SR_B4", "SR_B3", "SR_B2"])
            .multiply(0.0000275)
            .add(-0.2)
        )
        return reflectancias.visualize(min=0.02, max=0.35, gamma=1.15)
    raise ValueError(f"Fonte não suportada: {sensor}")


def ler_geojson(caminho: Path):
    dado = json.loads(caminho.read_text(encoding="utf-8"))
    if dado.get("type") == "FeatureCollection":
        raise ValueError("Use um Polygon ou Feature, não um FeatureCollection")
    if dado.get("type") == "Feature":
        dado = dado["geometry"]
    if dado.get("type") not in ("Polygon", "MultiPolygon"):
        raise ValueError("A geometria deve ser Polygon ou MultiPolygon")
    # Não simplificar nem modificar os vértices.
    return ee.Geometry(dado)


def exportar_thumb(imagem, regiao, destino: Path, tentativas=3):
    ultima_falha = None
    for tentativa in range(tentativas):
        try:
            url = imagem.getThumbURL({
                "region": regiao,
                "dimensions": "640",
                "format": "png",
            })
            resposta = requests.get(url, timeout=90)
            resposta.raise_for_status()
            with Image.open(io.BytesIO(resposta.content)) as entrada:
                imagem_webp = entrada.convert("RGB")
                imagem_webp.save(destino, "WEBP", quality=82, method=5)
            return
        except Exception as exc:
            ultima_falha = exc
            time.sleep(2 * (tentativa + 1))
    raise RuntimeError(f"Falha na prévia {destino.name}: {ultima_falha}")


def carregar_manifesto():
    if MANIFESTO.is_file():
        dado = json.loads(MANIFESTO.read_text(encoding="utf-8"))
        if isinstance(dado.get("previews"), dict):
            return dado
    return {"version": 1, "previews": {}}


def salvar_manifesto(manifesto):
    manifesto["version"] = 1
    manifesto["generatedAt"] = datetime.now(timezone.utc).isoformat()
    MANIFESTO.write_text(
        json.dumps(manifesto, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8"
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default="cuidai-agua")
    parser.add_argument("--limit", type=int, default=0,
                        help="Limitar número de cenas (0 = todas)")
    parser.add_argument("--geometry", type=Path, default=None,
                        help="GeoJSON do AOI ORIGINAL para prévias anuais MapBiomas")
    parser.add_argument("--only", choices=["all", "cenas", "mapbiomas"], default="all")
    args = parser.parse_args()

    try:
        ee.Initialize(project=args.project)
    except Exception as exc:
        raise SystemExit(
            "Earth Engine não autenticado. Entre na conta autorizada ao projeto "
            "'cuidai-agua' e inicialize a API antes de executar. "
            "Não salve credenciais neste repositório.\n" + str(exc)
        )

    DESTINO.mkdir(parents=True, exist_ok=True)
    manifesto = carregar_manifesto()
    feitos = 0
    ponto = ee.Geometry.Point(PONTO)
    recorte = ponto.buffer(3000).bounds()

    if args.only in ("all", "cenas"):
        with CSV_CENAS.open(newline="", encoding="utf-8-sig") as arquivo:
            cenas = list(csv.DictReader(arquivo))

        vistos = set()
        for cena in cenas:
            scene_id = cena["scene_id"].strip()
            sensor = cena["satellite"].strip()
            if not scene_id or scene_id in vistos:
                continue
            vistos.add(scene_id)
            nome = nome_arquivo(scene_id)
            destino = DESTINO / nome
            try:
                if not destino.is_file():
                    exportar_thumb(imagem_rgb(sensor, scene_id), recorte, destino)
                manifesto["previews"][scene_id] = "data/agua/previas/" + nome
                print(f"OK: {sensor} {cena['data']} {scene_id}")
                feitos += 1
                salvar_manifesto(manifesto)
                if args.limit > 0 and feitos >= args.limit:
                    break
            except Exception as exc:
                print(f"ERRO: {scene_id}: {exc}", file=sys.stderr)

    if args.only in ("all", "mapbiomas") and args.geometry is not None:
        aoi = ler_geojson(args.geometry)
        base = ee.Image.constant(1).visualize(palette=["E9F0F5"])
        anual = ee.Image(MAPBIOMAS_ASSET)
        borda = (ee.Image().byte().paint(
            ee.FeatureCollection([ee.Feature(aoi)]), 1, 2
        ).selfMask().visualize(palette=["F09449"]))
        area_mapa = aoi.bounds().buffer(400).bounds()
        with CSV_MAPBIOMAS.open(newline="", encoding="utf-8-sig") as arquivo:
            anos = list(csv.DictReader(arquivo))
        for linha in anos:
            ano = int(linha["ano"])
            chave = f"classification_{ano}"
            destino = DESTINO / nome_arquivo(chave)
            try:
                agua = (anual.select(chave).eq(1).selfMask().clip(aoi)
                    .visualize(palette=["168FC4"]))
                composicao = base.blend(agua).blend(borda)
                if not destino.is_file():
                    exportar_thumb(composicao, area_mapa, destino)
                manifesto["previews"][chave] = "data/agua/previas/" + destino.name
                print(f"OK: MapBiomas {ano}")
                feitos += 1
                salvar_manifesto(manifesto)
                if args.limit > 0 and feitos >= args.limit:
                    break
            except Exception as exc:
                print(f"ERRO: MapBiomas {ano}: {exc}", file=sys.stderr)

    if args.only == "mapbiomas" and args.geometry is None:
        raise SystemExit(
            "Para mapas MapBiomas é obrigatório --geometry com o AOI "
            "original exportado do Earth Engine; não criar contorno novo."
        )

    print(f"Total de prévias exportadas neste processo: {feitos}")
    print(f"Manifesto: {MANIFESTO}")
    print("As imagens geradas ainda precisam de revisão visual antes do push.")


if __name__ == "__main__":
    main()
