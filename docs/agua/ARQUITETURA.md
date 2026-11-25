# CUIDAÍ | Água — arquitetura inicial

## Reservatório piloto
- Nome: Açude São José III.
- Município: Ipaporanga/CE.
- Capacidade nominal: 9,12 hm³, conforme ficha técnica da COGERH.
- Divergência a confirmar: uma publicação acadêmica anterior registra 7,96 hm³. A capacidade e a curva cota-área-volume vigentes devem ser confirmadas com a COGERH antes de cálculos de volume ou balanço hídrico.
- Área da bacia hidrográfica: 99,35 km².
- Riacho barrado: Riacho São José.
- Coordenadas de referência: -4.8986, -40.7703, obtidas no documento de planejamento hídrico da COGERH.
- A coordenada é um ponto de referência; não substitui o polígono geográfico do espelho d'água.

## Camadas
1. Fontes: COGERH, Open-Meteo, Sentinel-2 L2A Harmonized, Landsat 8/9 C2 L2 e futura estação local.
2. Processamento: máscara de nuvens/sombras, NDWI, área superficial, evaporação de água livre e balanço hídrico.
3. Dados: reservatórios, leituras hidrometeorológicas, cenas processadas e estimativas com metadados de origem.
4. Aplicação: visão geral, ficha do reservatório, satélite, evaporação, meteorologia e relatórios.
5. Saídas: mapa, séries temporais, comparador, PDF e CSV.

## Coleções Firestore previstas
- reservatorios: cadastro e características técnicas.
- leiturasHidrometeorologicas: leituras de estação, com unidade, instante, equipamento e qualidade.
- analisesSuperficie: cenas processadas, área, sensor, cobertura de nuvens, método e imagem de prévia.
- estimativasEvaporacao: lâmina e volume estimados, método, parâmetros, intervalo e incerteza.

A implementação inicial mantém o cadastro do reservatório em configuração tipada e consulta meteorologia diretamente à Open-Meteo. As coleções acima definem o contrato futuro; regras e ingestão do Firestore serão configuradas antes de habilitar gravações.

## Regras de fidelidade
- Nunca preencher indicadores ausentes com números fictícios.
- Separar medição de sensor, dado oficial, estimativa de API, resultado de satélite e simulação.
- Cada série deve guardar fonte, data/hora, unidade, método, resolução e indicador de qualidade.
- Área superficial não equivale a volume armazenado.
- Variação de volume não equivale automaticamente a evaporação.
- ET₀ de referência não deve ser apresentada como evaporação direta de água livre.
- Cálculos volumétricos dependem da área inundada correspondente ao período.
- Estimativas de evaporação precisam de método para água livre e calibração local.

## Sensoriamento remoto
- Sentinel-2 L2A Harmonized é a fonte principal, com resolução de 10 m nas bandas usadas no NDWI e revisita nominal de cinco dias.
- Landsat 8/9 Collection 2 Level-2 complementa a série histórica, com resolução de 30 m nas bandas usadas no NDWI.
- A disponibilidade efetiva depende de cobertura de nuvens, sombras e cenas válidas.
- O processamento registra cobertura válida sobre o AOI, porcentagem de nuvens, limiar NDWI e resolução de cada cena.
- Os limiares NDWI são configuráveis separadamente para Sentinel-2 e Landsat.
- O gráfico do painel filtra um sensor por vez; comparações entre sensores exibem aviso devido às diferenças de resolução e resposta espectral.
- O script scripts/earth-engine/sao-jose-iii-area-series.js exporta uma tabela CSV de área superficial por aquisição.
- O polígono AOI precisa ser delimitado e validado manualmente no Earth Engine antes do primeiro processamento.
- O limiar NDWI inicial é provisório e precisa ser calibrado com imagens e referência de campo.

## Estação futura
Contrato de leitura previsto:
- temperatura do ar (°C);
- umidade relativa (%);
- velocidade e direção do vento (m/s, graus);
- radiação solar (W/m²);
- precipitação (mm);
- pressão atmosférica (hPa);
- nível da água (m);
- temperatura da água (°C, opcional);
- bateria, conectividade, identificação do sensor, instante e qualidade.

A estação não será considerada operacional até instalação, calibração e validação de transmissão.

## Primeira entrega
- Módulo web isolado no painel CUIDAÍ.
- Meteorologia estimada via Open-Meteo.
- Ficha técnica e localização do reservatório.
- Importação de série CSV produzida no Earth Engine.
- A importação CSV inicial fica na sessão do navegador; persistência no Firestore e prévias de imagem serão conectadas em etapa posterior.
- Gráfico com agregação diária, mensal ou anual por mediana.
- Comparação de duas cenas.
- Calculadora transparente de conversão de lâmina evaporada em volume.
- Exportação CSV e impressão para PDF.

## Entrega acelerada — integração MapBiomas Água e COGERH (25/11/2026)

- **COGERH:** o painel mostra uma leitura **datada** do São José III (24/11/2026):
  cota de referência 98,82 m, volume 6,54 hm³, 71,72% da capacidade,
  consultada no Portal Hidrológico do Ceará. NÃO é atualização em tempo real.
  Fonte: https://www.hidro.ce.gov.br/
- **MapBiomas Água:** a Coleção 5 fornece classificação **anual de água
  1985–2025**, com resolução de 30 m. A fonte oficial está documentada em
  https://brasil.mapbiomas.org/iniciativas-e-produtos/agua/mapeamento-anual/tempo-desde-a-ultima-ocorrencia-de-superficie-de-agua/ .
- **Processamento Earth Engine concluído:** o script
  `scripts/earth-engine/04-mapbiomas-agua-serie-anual.js` usa a AOI `geometry`
  preservada, e já produziu a série anual 1985–2025. A execução não substitui
  a validação da AOI contra o máximo histórico de inundação.
- **Ingestão automática no painel:** o CSV real de 41 anos está publicado em
  `public/data/cuidai-agua-sao-jose-iii-mapbiomas.csv`. O painel carrega esse
  arquivo na inicialização, sem upload manual dos visitantes; registros locais
  continuam disponíveis para outras fontes.
- **Importação manual opcional:** CSV via interface, com preservação local dos
  últimos dados importados. O carregamento automático nunca converte
  informação municipal agregada em estimativa do reservatório.
- **Processamento concluído em 25/11/2026:** a operação autenticada
  no Google Earth Engine confirmou o asset MapBiomas Água Coleção 5, a classe 1,
  as bandas 1985–2025 e a AOI original de **411 vértices**. Foram exportados
  **41 registros** e o CSV foi publicado em
  `public/data/cuidai-agua-sao-jose-iii-mapbiomas.csv`.
- **Consistência do CSV:** 41 anos consecutivos (1985–2025), sem valores ausentes,
  negativos, anos duplicados ou áreas acima da AOI aproximada de **213,40 ha**.
  Área anual mapeada de **2025: 148,12 ha**. Área máxima observada
  na série: **184,38 ha (2004)**; mínima: **0,09 ha (1987)**.
  O valor mínimo corresponde aproximadamente a um pixel de 30 m;
  **não deve ser interpretado como prova de seca**.
- **Proveniência do CSV:** SHA-256 do arquivo exportado:
  `c02d6c86f34a0838cd28d800e849ad814a728005193a36f3e8a6b44fcd9ce82a`.
- **Validação científica limitada:** consistência de estrutura e intervalo
  confirmada, mas ainda falta conferir anos de cheia com cartografia oficial,
  avaliar o viés da AOI ajustada à água de 2026 e quantificar incertezas.
  Não utilizar a máscara binária MapBiomas como indicador de cobertura
  observacional; pixels sem classificação positiva não comprovam ausência de água.
- **NÃO concluído:** atualização ao vivo da COGERH, estação instalada,
  estimação calibrada de evaporação, validação hidrológica de campo e publicação
  independente no Firebase Hosting. A compilação por CI valida a aplicação,
  não garante uma publicação do site.

### Integridade: fontes diferentes, grandezas diferentes

- MapBiomas Água: área anual classificada como água (ha); data `YYYY-12-31`
  no CSV é apenas MARCADOR DO ANO, não data de aquisição de uma cena.
- Sentinel-2: área observada na data específica, sob máscara de nuvens.
- COGERH: volume armazenado (hm³), nível/cota (m), percentual (%).
- Open-Meteo: informações meteorológicas estimadas por modelo.
- Evaporação: aguarda taxa tecnicamente validada para superfície de água livre.

## Históricos por fonte e experiência de leitura (25/11/2026)

- **MapBiomas anual** já publicado: a linha usa segmentos retos e marcadores
  em cada um dos 41 anos. O gráfico destaca a maior área, a menor área e
  a observação mais recente, deixando explícito que valores mínimos pequenos
  (por exemplo, 1987) não comprovam seca completa do reservatório.
- **Metodologia** em seção expansível para reduzir excesso de texto sem
  esconder limites científicos da classificação anual.
- **Sentinel-2 e Landsat não são sinônimos de MapBiomas:** seus seletores
  permanecem disponíveis, mas mostram mensagem de ausência enquanto não
  houver cálculos individuais validados. Não são preenchidos com valores
  MapBiomas nem com séries sintéticas.
- **Nova rotina unificada:** `scripts/earth-engine/05-cenas-sentinel-landsat-2023-2026.js`
  calcula áreas provisórias com NDWI > 0 nas cenas reais de 2023 a
  25/11/2026 e exporta os registros de ambas as fontes em um único CSV.
  São usados controle de nuvens/sombras e cobertura espacial mínima de 85%
  dentro da AOI. O limiar NDWI e as áreas carecem de calibração e validação.
  Não interpretar anos/cenas sem observação como área zero.
- **Carregamento futuro:** publicar o arquivo resultante em
  `public/data/cuidai-agua-sao-jose-iii-cenas-2023-2026.csv`.
  O painel já busca essa URL ao iniciar, combina os registros com o histórico
  MapBiomas e mantém filtros independentes.
- **Pendência externa:** o script 05 foi preparado no GitHub, mas não foi
  executado numa sessão autenticada do Earth Engine nesta implementação.
  Portanto, ainda não há série Sentinel-2/Landsat publicada; o build não
  implica processamento satelital.
