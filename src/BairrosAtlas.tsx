import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { FeatureCollection, Geometry } from 'geojson';

function dentroDoAnel(
    anel: number[][],
    latitude: number,
    longitude: number
): boolean {
    let dentro = false;

    for (
        let i = 0, j = anel.length - 1;
        i < anel.length;
        j = i++
    ) {
        const [xi, yi] = anel[i];
        const [xj, yj] = anel[j];

        const cruza =
            (yi > latitude) !== (yj > latitude) &&
            longitude <
            ((xj - xi) * (latitude - yi)) /
            (yj - yi) + xi;

        if (cruza) dentro = !dentro;
    }

    return dentro;
}

function contemPonto(
    geometria: Geometry,
    latitude: number,
    longitude: number
): boolean {
    const poligonos =
        geometria.type === 'Polygon'
            ? [geometria.coordinates]
            : geometria.type === 'MultiPolygon'
                ? geometria.coordinates
                : [];

    return poligonos.some(aneis =>
        dentroDoAnel(aneis[0], latitude, longitude) &&
        !aneis.slice(1).some(anel =>
            dentroDoAnel(anel, latitude, longitude)
        )
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function identificarBairro(
    bairros: FeatureCollection | null,
    latitude: number,
    longitude: number
): string | null {
    if (!bairros) return null;

    for (const bairro of bairros.features) {
        if (
            !bairro.geometry ||
            !contemPonto(bairro.geometry, latitude, longitude)
        ) continue;

        const propriedades = bairro.properties ?? {};

        const nome = [
            propriedades.Nome,
            propriedades.nome,
            propriedades.NOME,
            propriedades.bairro,
            propriedades.BAIRRO,
            propriedades.nome_bairro,
            propriedades.NM_BAIRRO,
            propriedades.name
        ].find(
            valor =>
                typeof valor === 'string' &&
                valor.trim().length > 0
        );

        return typeof nome === 'string' ? nome : null;
    }

    return null;
}

export default function BairrosAtlas({
    bairros,
    ativo
}: {
    bairros: FeatureCollection | null;
    ativo: boolean;
}) {
    const map = useMap();

    useEffect(() => {
        if (!ativo || !bairros) return;

        const tooltip = L.tooltip({
            direction: 'top',
            offset: [0, -12],
            opacity: 1,
            className: 'atlas-tooltip-bairro'
        });

        const conteudo = document.createElement('span');

        const informar = (evento: L.LeafletMouseEvent) => {
            const nome = identificarBairro(
                bairros,
                evento.latlng.lat,
                evento.latlng.lng
            );

            if (!nome) {
                map.closeTooltip(tooltip);
                return;
            }

            conteudo.textContent = nome;

            tooltip
                .setLatLng(evento.latlng)
                .setContent(conteudo);

            map.openTooltip(tooltip);
        };

        const fechar = () => map.closeTooltip(tooltip);

        map.on('mousemove', informar);
        map.on('click', informar);
        map.on('mouseout', fechar);

        return () => {
            map.off('mousemove', informar);
            map.off('click', informar);
            map.off('mouseout', fechar);
            fechar();
        };
    }, [map, bairros, ativo]);

    return null;
}