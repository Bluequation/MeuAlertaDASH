
import type { Geometry } from 'geojson';

export type PontoTermicoMunicipal = {
    latitude: number;
    longitude: number;
    temperatura: number;
};

export type PerfilTermicoMunicipal = {
    minima: number;
    media: number;
    maxima: number;
    amostras: number;
    horario: string;
    coordenadasConsultadas: number;
    celulasIdentificadas: boolean;
    pontos: PontoTermicoMunicipal[];
};

type Ponto = {
    latitude: number;
    longitude: number;
};

// Verifica se um ponto está dentro de um anel geográfico.
function dentroDoAnel(
    x: number,
    y: number,
    anel: number[][]
): boolean {
    let dentro = false;

    for (
        let i = 0, j = anel.length - 1;
        i < anel.length;
        j = i++
    ) {
        const [xi, yi] = anel[i];
        const [xj, yj] = anel[j];

        if (
            (yi > y) !== (yj > y) &&
            x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
        ) {
            dentro = !dentro;
        }
    }

    return dentro;
}

// Considera também os anéis internos (buracos).
function dentroDoPoligono(
    x: number,
    y: number,
    aneis: number[][][]
): boolean {
    return (
        aneis.length > 0 &&
        dentroDoAnel(x, y, aneis[0]) &&
        !aneis.slice(1).some(
            anel => dentroDoAnel(x, y, anel)
        )
    );
}

// Gera até 25 pontos dentro dos limites municipais.

const ESPACAMENTO_AMOSTRAL_KM = 3;
const MAXIMO_COORDENADAS = 90;
const KM_POR_GRAU = 111.32;

// Distribuição espacial aproximada.
// O espaçamento é um parâmetro experimental,
// não a resolução oficial do modelo meteorológico.
export function gerarAmostrasMunicipais(
    geometria: Geometry
): Ponto[] {
    const poligonos =
        geometria.type === 'Polygon'
            ? [geometria.coordinates]
            : geometria.type === 'MultiPolygon'
                ? geometria.coordinates
                : [];

    if (poligonos.length === 0) return [];

    const vertices = poligonos.flatMap(
        poligono => poligono[0]
    );

    const oeste = Math.min(
        ...vertices.map(p => p[0])
    );

    const leste = Math.max(
        ...vertices.map(p => p[0])
    );

    const sul = Math.min(
        ...vertices.map(p => p[1])
    );

    const norte = Math.max(
        ...vertices.map(p => p[1])
    );

    const latitudeCentral = (sul + norte) / 2;

    const kmPorGrauLongitude =
        KM_POR_GRAU *
        Math.cos(latitudeCentral * Math.PI / 180);

    const pertenceAoMunicipio = (
        longitude: number,
        latitude: number
    ) =>
        poligonos.some(poligono =>
            dentroDoPoligono(
                longitude,
                latitude,
                poligono
            )
        );

    const criarGrade = (espacamentoKm: number) => {
        const linhas = Math.max(
            1,
            Math.ceil(
                (norte - sul) * KM_POR_GRAU /
                espacamentoKm
            )
        );

        const colunas = Math.max(
            1,
            Math.ceil(
                (leste - oeste) *
                kmPorGrauLongitude /
                espacamentoKm
            )
        );

        const candidatos: Ponto[] = [];

        for (let linha = 0; linha < linhas; linha++) {
            const latitude =
                sul + ((linha + 0.5) / linhas) *
                (norte - sul);

            for (
                let coluna = 0;
                coluna < colunas;
                coluna++
            ) {
                const longitude =
                    oeste +
                    ((coluna + 0.5) / colunas) *
                    (leste - oeste);

                if (
                    pertenceAoMunicipio(
                        longitude,
                        latitude
                    )
                ) {
                    candidatos.push({
                        latitude,
                        longitude
                    });
                }
            }
        }

        return candidatos;
    };

    // Reduz o espaçamento apenas quando nenhuma
    // posição foi encontrada no território.
    let candidatos: Ponto[] = [];

    for (const espacamento of [ESPACAMENTO_AMOSTRAL_KM, 1.5, 0.75]) {
        candidatos = criarGrade(espacamento);

        if (candidatos.length > 0) break;
    }

    if (candidatos.length <= MAXIMO_COORDENADAS) {
        return candidatos;
    }

    // Se houver muitos candidatos, seleciona
    // pontos afastados entre si para preservar
    // a cobertura espacial.
    const distanciaQuadrada = (
        a: Ponto,
        b: Ponto
    ) => {
        const dx =
            (a.longitude - b.longitude) *
            kmPorGrauLongitude;

        const dy =
            (a.latitude - b.latitude) *
            KM_POR_GRAU;

        return dx * dx + dy * dy;
    };

    const restantes = [...candidatos];

    const escolhidos: Ponto[] = [
        restantes.splice(
            Math.floor(restantes.length / 2),
            1
        )[0]
    ];

    while (
        escolhidos.length < MAXIMO_COORDENADAS &&
        restantes.length > 0
    ) {
        let melhorIndice = 0;
        let maiorDistancia = -1;

        for (let i = 0; i < restantes.length; i++) {
            const menorDistancia = Math.min(
                ...escolhidos.map(escolhido =>
                    distanciaQuadrada(
                        restantes[i],
                        escolhido
                    )
                )
            );

            if (menorDistancia > maiorDistancia) {
                maiorDistancia = menorDistancia;
                melhorIndice = i;
            }
        }

        escolhidos.push(
            restantes.splice(melhorIndice, 1)[0]
        );
    }

    return escolhidos;
}


// Consulta a Open-Meteo e calcula o perfil amostral.
export async function consultarPerfilTermicoMunicipal(
    geometria: Geometry,
    signal: AbortSignal
): Promise<PerfilTermicoMunicipal> {
    const pontos = gerarAmostrasMunicipais(geometria);

    if (pontos.length === 0) {
        throw new Error(
            'Amostragem municipal insuficiente.'
        );
    }

    const parametros = new URLSearchParams({
        latitude: pontos
            .map(p => p.latitude.toFixed(5))
            .join(','),

        longitude: pontos
            .map(p => p.longitude.toFixed(5))
            .join(','),

        current: 'temperature_2m',
        timezone: 'America/Fortaleza'
    });

    const resposta = await fetch(
        `https://api.open-meteo.com/v1/forecast?${parametros.toString()}`,
        { signal }
    );

    if (!resposta.ok) {
        throw new Error(
            `Open-Meteo: HTTP ${resposta.status}`
        );
    }


    const resultados: unknown = await resposta.json();

    // Com uma coordenada, a API pode retornar
    // um objeto; com várias, retorna uma lista.
    const respostas: unknown[] =
        Array.isArray(resultados)
            ? resultados
            : [resultados];

    if (respostas.length !== pontos.length) {
        throw new Error(
            'A resposta não corresponde às coordenadas consultadas.'
        );
    }

    const leituras = respostas.map((resultado, indice) => {
        const dado = resultado as {
            latitude?: unknown;
            longitude?: unknown;
            current?: {
                temperature_2m?: unknown;
                time?: unknown;
            };
        };

        const temperatura =
            dado?.current?.temperature_2m;

        const horario = dado?.current?.time;

        if (
            typeof temperatura !== 'number' ||
            !Number.isFinite(temperatura) ||
            typeof horario !== 'string'
        ) {
            throw new Error(
                'Uma ou mais leituras meteorológicas são inválidas.'
            );
        }

        const latitudeModelo = dado.latitude;
        const longitudeModelo = dado.longitude;

        const possuiCelula =
            typeof latitudeModelo === 'number' &&
            Number.isFinite(latitudeModelo) &&
            typeof longitudeModelo === 'number' &&
            Number.isFinite(longitudeModelo);

        // As coordenadas retornadas identificam
        // o centro da grade meteorológica utilizada.
        const chaveCelula = possuiCelula
            ? `${latitudeModelo.toFixed(4)},${longitudeModelo.toFixed(4)}`
            : `consulta-${indice}`;

        // Se várias posições usaram a mesma célula,
        // será mantida a mais próxima do centro dela.
        const distanciaCentro = possuiCelula
            ? (
                Math.pow(
                    (pontos[indice].latitude -
                        latitudeModelo) * 111.32,
                    2
                ) +
                Math.pow(
                    (pontos[indice].longitude -
                        longitudeModelo) *
                    111.32 *
                    Math.cos(
                        pontos[indice].latitude *
                        Math.PI / 180
                    ),
                    2
                )
            )
            : 0;

        return {
            ponto: pontos[indice],
            temperatura,
            horario,
            chaveCelula,
            possuiCelula,
            distanciaCentro
        };
    });

    // Compara apenas valores do mesmo horário.
    const horarios = new Set(
        leituras.map(leitura => leitura.horario)
    );

    if (horarios.size !== 1) {
        throw new Error(
            'Os pontos retornaram horários diferentes.'
        );
    }

    // Remove repetição das células identificadas.
    const porCelula = new Map<
        string,
        (typeof leituras)[number]
    >();

    for (const leitura of leituras) {
        const anterior = porCelula.get(
            leitura.chaveCelula
        );

        if (
            !anterior ||
            leitura.distanciaCentro <
            anterior.distanciaCentro
        ) {
            porCelula.set(
                leitura.chaveCelula,
                leitura
            );
        }
    }

    const amostras = Array.from(
        porCelula.values()
    );

    if (amostras.length === 0) {
        throw new Error(
            'Nenhuma amostra meteorológica válida.'
        );
    }

    const valores = amostras.map(
        amostra => amostra.temperatura
    );

    return {
        minima: Math.min(...valores),

        media:
            valores.reduce(
                (soma, valor) => soma + valor,
                0
            ) / valores.length,

        maxima: Math.max(...valores),

        amostras: amostras.length,

        horario: amostras[0].horario,

        coordenadasConsultadas: pontos.length,

        celulasIdentificadas: leituras.every(
            leitura => leitura.possuiCelula
        ),

        pontos: amostras.map(amostra => ({
            latitude: amostra.ponto.latitude,
            longitude: amostra.ponto.longitude,
            temperatura: amostra.temperatura
        }))
    };
}

