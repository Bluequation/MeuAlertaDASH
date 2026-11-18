/**
 * Consulta opcional de estimativas históricas Open-Meteo, na coordenada
 * real da estação. Nunca trata estimativas como medições físicas.
 *
 * Dados: Historical Weather API (ECMWF IFS / best match).
 * Resolução temporal da fonte: horária.
 */
import { consultarOpenMeteoComCache } from './openMeteoCache';

export type AmostraOpenMeteo = {
    recebidoEm: number;
    temperatura: number;
    umidade: number;
};

type RespostaOpenMeteo = {
    error?: boolean;
    reason?: string;
    hourly?: {
        time?: Array<string | number>;
        temperature_2m?: Array<number | null>;
        relative_humidity_2m?: Array<number | null>;
    };
};

const DIA = 24 * 60 * 60 * 1000;

const dataUTC = (instante: number) =>
    new Date(instante).toISOString().slice(0, 10);

export async function consultarHistoricoOpenMeteo(
    latitude: number,
    longitude: number,
    inicio: number,
    fim: number,
    sinal: AbortSignal
): Promise<AmostraOpenMeteo[]> {
    if (
        !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        !Number.isFinite(inicio) || !Number.isFinite(fim) ||
        fim < inicio
    ) {
        throw new Error('Coordenadas ou período inválidos.');
    }

    const parametros = new URLSearchParams({
        latitude: latitude.toFixed(5),
        longitude: longitude.toFixed(5),
        start_date: dataUTC(inicio - DIA),
        end_date: dataUTC(Math.min(fim + DIA, Date.now())),
        hourly: 'temperature_2m,relative_humidity_2m',
        timezone: 'GMT',
        timeformat: 'unixtime',
        temperature_unit: 'celsius'
    });

    const url = `https://archive-api.open-meteo.com/v1/archive?${parametros.toString()}`;
    const resposta = await consultarOpenMeteoComCache(url, sinal) as RespostaOpenMeteo;

    if (resposta?.error) {
        throw new Error(resposta.reason || 'Open-Meteo indisponível.');
    }

    const horarios = resposta?.hourly?.time;
    const temperaturas = resposta?.hourly?.temperature_2m;
    const umidades = resposta?.hourly?.relative_humidity_2m;

    if (
        !Array.isArray(horarios) ||
        !Array.isArray(temperaturas) ||
        !Array.isArray(umidades)
    ) {
        throw new Error('Resposta histórica Open-Meteo sem dados horários.');
    }

    const amostras: AmostraOpenMeteo[] = [];
    for (let i = 0; i < horarios.length; i++) {
        const t = horarios[i];
        // unixtime na Open-Meteo: segundos UTC, sem deslocamento manual.
        const recebidoEm = typeof t === 'number' ? t * 1000 : Date.parse(t);
        const temperatura = temperaturas[i];
        const umidade = umidades[i];
        if (
            !Number.isFinite(recebidoEm) ||
            recebidoEm < inicio ||
            recebidoEm > fim ||
            typeof temperatura !== 'number' ||
            !Number.isFinite(temperatura) ||
            temperatura < -60 || temperatura > 70 ||
            typeof umidade !== 'number' ||
            !Number.isFinite(umidade) ||
            umidade < 0 || umidade > 100
        ) continue;
        amostras.push({ recebidoEm, temperatura, umidade });
    }

    return amostras.sort((a, b) => a.recebidoEm - b.recebidoEm);
}
