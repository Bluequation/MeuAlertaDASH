# CUIDAÍ | Água — imagens de prévia verificáveis

## Situação

O CSV do Earth Engine contém datas, sensores, área estimada e identificadores,
mas **não contém imagens**. O painel não deve substituir cada cena por um mosaico
genérico, uma captura de Google Maps de data desconhecida ou uma imagem gerada
artificialmente.

O comparador agora usa um manifesto de recursos reais:
`public/data/cuidai-agua-sao-jose-iii-previas.json`.
Enquanto vazio, mostra metadados auditáveis, identificação da cena e links de
consulta nas fontes originais.

## Exportar e publicar (uma única operação autorizada no Earth Engine)

Um ambiente autenticado no projeto **cuidai-agua** pode executar:

```sh
pip install earthengine-api pillow requests
python scripts/earth-engine/06-exportar-previas.py --project cuidai-agua
```

O script lê as 96 cenas reais do CSV publicado e busca cada ID diretamente
nos assets Sentinel-2 e Landsat 8/9 do Earth Engine. Faz uma prévia RGB de
640 pixels, centrada no ponto de referência, baixa a imagem imediatamente,
converte para WebP e atualiza o manifesto.

**Os WebP são imagens reais das aquisições**. A prévia é um recorte de cerca de
6 km no entorno do reservatório e não substitui o AOI original de 411 vértices
nem representa a máscara de água NDWI. Mostrar essa imagem permite avaliar
nuvens, sombras e cobertura de cena visualmente; não valida os hectares sem
outros controles.

Para prévias de **classificação anual do MapBiomas**, é obrigatório fornecer
um GeoJSON do mesmo polígono original (sem simplificar vértices):

```sh
python scripts/earth-engine/06-exportar-previas.py \
  --project cuidai-agua --only mapbiomas \
  --geometry /caminho/para/geometry-original-411-vertices.geojson
```

Esse modo exporta a classificação anual de água como mapa temático, limitado
pela geometria, com borda laranja e água azul; **não é uma fotografia de 31/12**.
Sem acesso ao GeoJSON original, o script não inventa um contorno.

## Publicação

Após conferir visualmente algumas imagens, adicionar ao GitHub apenas os
arquivos de `public/data/agua/previas/` e o manifesto atualizado em
`public/data/cuidai-agua-sao-jose-iii-previas.json`, no branch
`feat/cuidai-agua-sao-jose-iii`. A aplicação passa a detectar as imagens
automaticamente, sem necessidade de alterar o CSV.

Não enviar senhas, tokens do Earth Engine ou links temporários assinados ao
repositório. Não associar uma imagem de data distinta ao registro selecionado.

## Fontes externas

- Sentinel-2: Copernicus Browser, com busca por data e coordenadas; conferir
  o identificador da cena correspondente.
- Landsat: USGS EarthExplorer, buscar a imagem pelo scene_id do painel.
- MapBiomas: plataforma MapBiomas Água.

O carregamento das prévias é **opcional** e não pode bloquear gráficos,
cálculos ou relatórios quando as imagens não estiverem disponíveis.
