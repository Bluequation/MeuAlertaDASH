
import type { Geometry } from 'geojson';

export type PerfilTermicoMunicipal = {
    minima: number;
    media: number;
    maxima: number;
    amostras: number;
    horario: string;
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
export function gerarAmostrasMunicipais(
    geometria: Geometry
): Ponto[] {
    const poligonos =
        geometria.type === 'Polygon'
            ? [geometria.coordinates]
            : geometria.type === 'MultiPolygon'
                ? geometria.coordinates
                : [];

    if (poligonos.length === 0) {
        return [];
    }

    const coordenadas = poligonos.flatMap(
        poligono => poligono[0]
    );

    const longitudes = coordenadas.map(
        ponto => ponto[0]
    );

    const latitudes = coordenadas.map(
        ponto => ponto[1]
    );

    const oeste = Math.min(...longitudes);
    const leste = Math.max(...longitudes);
    const sul = Math.min(...latitudes);
    const norte = Math.max(...latitudes);

    const candidatos: Ponto[] = [];

    // Grade de candidatos distribuídos pelo território.
    const divisoes = 25;

    for (let linha = 0; linha < divisoes; linha++) {
        for (let coluna = 0; coluna < divisoes; coluna++) {
            const longitude =
                oeste +
                ((coluna + 0.5) / divisoes) *
                (leste - oeste);

            const latitude =
                sul +
                ((linha + 0.5) / divisoes) *
                (norte - sul);

            const pertenceAoMunicipio = poligonos.some(
                poligono =>
                    dentroDoPoligono(
                        longitude,
                        latitude,
                        poligono
                    )
            );

            if (pertenceAoMunicipio) {
                candidatos.push({
                    latitude,
                    longitude
                });
            }
        }
    }

    const total = Math.min(25, candidatos.length);

    return Array.from(
        { length: total },
        (_, indice) =>
            candidatos[
            Math.floor(
                ((indice + 0.5) *
                    candidatos.length) /
                total
            )
            ]
    );
}

// Consulta a Open-Meteo e calcula o perfil amostral.
export async function consultarPerfilTermicoMunicipal(
    geometria: Geometry,
    signal: AbortSignal
): Promise<PerfilTermicoMunicipal> {
    const pontos = gerarAmostrasMunicipais(geometria);

    if (pontos.length < 5) {
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

    if (
        !Array.isArray(resultados) ||
        resultados.length !== pontos.length
    ) {
        throw new Error(
            'A resposta não corresponde aos pontos amostrados.'
        );
    }

    const leituras = resultados.map(
        (resultado: unknown) => {
            const atual = (
                resultado as {
                    current?: {
                        temperature_2m?: unknown;
                        time?: unknown;
                    };
                }
            )?.current;

            if (
                typeof atual?.temperature_2m !== 'number' ||
                !Number.isFinite(atual.temperature_2m) ||
                typeof atual.time !== 'string'
            ) {
                throw new Error(
                    'Uma ou mais leituras meteorológicas são inválidas.'
                );
            }

            return {
                temperatura: atual.temperature_2m,
                horario: atual.time
            };
        }
    );

    // Garante que todos os pontos tenham a mesma referência.
    const horarios = new Set(
        leituras.map(leitura => leitura.horario)
    );

    if (horarios.size !== 1) {
        throw new Error(
            'Os pontos retornaram horários diferentes.'
        );
    }

    const valores = leituras.map(
        leitura => leitura.temperatura
    );

    return {
        minima: Math.min(...valores),

        media:
            valores.reduce(
                (soma, valor) => soma + valor,
                0
            ) / valores.length,

        maxima: Math.max(...valores),

        amostras: valores.length,

        horario: leituras[0].horario
    };
}
