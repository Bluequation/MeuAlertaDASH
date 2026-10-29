
import type { Geometry } from 'geojson';

export type EstacaoPublica = {
    id: string;
    nome: string;
    municipio: string;
    latitude: number;
    longitude: number;
    experimental: boolean;
    ultimaLeitura: {
        temperatura: number;
        umidade: number;
        recebidoEm: number;
    } | null;
};

function dentroDoAnel(
    longitude: number,
    latitude: number,
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
            (yi > latitude) !== (yj > latitude) &&
            longitude <
            ((xj - xi) * (latitude - yi)) /
            (yj - yi) + xi
        ) {
            dentro = !dentro;
        }
    }

    return dentro;
}

function dentroDoPoligono(
    longitude: number,
    latitude: number,
    aneis: number[][][]
): boolean {
    return (
        aneis.length > 0 &&
        dentroDoAnel(longitude, latitude, aneis[0]) &&
        !aneis.slice(1).some(anel =>
            dentroDoAnel(longitude, latitude, anel)
        )
    );
}

export function estacaoDentroDoMunicipio(
    geometria: Geometry,
    latitude: number,
    longitude: number
): boolean {
    if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
    ) {
        return false;
    }

    if (geometria.type === 'Polygon') {
        return dentroDoPoligono(
            longitude,
            latitude,
            geometria.coordinates
        );
    }

    if (geometria.type === 'MultiPolygon') {
        return geometria.coordinates.some(poligono =>
            dentroDoPoligono(
                longitude,
                latitude,
                poligono
            )
        );
    }

    return false;
}
