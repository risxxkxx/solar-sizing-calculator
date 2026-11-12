/**
 * UI strings. All user-facing text lives in this one dictionary.
 * Placeholders use {name} and are filled by t(key, params).
 */
export const STRINGS = {
  mk: {
    title: 'Калкулатор за димензионирање на сончев систем',
    subtitle: 'Првична пресметка на фотонапонски панели, батерија и инвертер за домаќинство или мал бизнис, врз основа на локацијата, потрошувачката и режимот на користење. Секој резултат може да се провери преку прикажаните формули.',
    badge: 'ⓘ Ориентациона процена — не е замена за професионален PV дизајн',

    params: 'Параметри',
    modeSize: 'Димензионирај за мене',
    modeCheck: 'Провери го мојот систем',
    modeSizeNote: 'Калкулаторот препорачува панели и батерија за најлошиот месец.',
    modeCheckNote: 'Внеси ги твоите панели и батерија — трите проверки можат навистина да паднат.',

    secLocation: 'Локација',
    city: 'Град',
    secSystem: 'Систем',
    panelWp: 'Watt по панел (W)',
    panelsInstalled: 'Број на панели',
    tilt: 'Тилт (наклон)',
    tiltNote: '0° = рамен покрив, 90° = фасада. 34° е блиску до оптимум за Македонија.',
    azimuth: 'Азимут',
    azimuthNote: '0° = север, 90° = исток, 180° = југ, 270° = запад',
    recommendedPanels: 'Препорачани панели: <strong>{panels}</strong> ({kWp} kWp) — за соларот да ја покрие дневната потрошувачка И да ја наполни батеријата во најлошиот месец ({month})',

    secConsumption: 'Потрошувачка',
    consumption: 'Дневна потрошувачка (kWh/ден)',
    peakLoad: 'Врвно оптоварување (kW)',
    peakLoadNote: 'Најголема истовремена моќност (бојлер + шпорет + клима…)',
    nightStart: 'Ноќ од',
    nightEnd: 'Ноќ до',
    nightWindowNote: 'Часови без корисно сонце — тогаш потрошувачката ја покрива батеријата.',
    nightShare: 'Удел на потрошувачка ноќе (%)',
    nightShareAuto: 'пропорционално на часовите (рамномерна потрошувачка)',

    secBattery: 'Батерија',
    batteryInstalled: 'Инсталирана батерија (kWh, номинално)',
    dod: 'Длабочина на празнење (DoD)',
    efficiency: 'Ефикасност на полнење/празнење (round-trip)',
    efficiencyNote: 'LFP батерии + инвертер: типично 88–95%',
    autonomy: 'Денови автономија',
    autonomyNote: '1 = една ноќ. 0 = без батерија. Месечните просеци ги кријат облачните периоди од неколку дена — за критични потрошувачи размисли за 2+.',

    secInverter: 'Инвертер',
    dcAc: 'DC/AC однос',
    dcAcNote: 'kWp панели ÷ kW инвертер. Типично 1,1–1,3.',

    sourceOffline: 'Извор на податоци: <strong>приближна офлајн процена</strong> — регионална табела (34°/југ) × фактор за ориентација ×{factor}',
    sourceLive: 'Извор на податоци: <strong>PVGIS {version} (во живо)</strong> — {db}',
    sourceLoading: 'Се вчитуваат PVGIS податоци… во меѓувреме: офлајн процена.',
    sourcePvgisError: 'PVGIS не врати податоци за оваа точка ({msg}).',
    sourceInvalidCoords: 'Внеси валидна географска ширина (−90…90) и должина (−180…180).',
    sourceNearest: '(најблизок град од табелата: {city})',
    sourceNoProxy: 'Податоци во живо од PVGIS се достапни кога страницата работи на Netlify (или „netlify dev“).',
    customLocation: 'Сопствени координати…',
    lat: 'Ширина (lat)',
    lng: 'Должина (lng)',
    sourceOfflineTip: 'Табелата содржи приближни регионални вредности, не официјални GSA податоци.',

    // verdict
    recTitle: 'ПРЕПОРАКА ЗА СИСТЕМ',
    recText: '{panels} × {wp} W = {kWp} kWp, батерија {gross} kWh номинално ({usable} kWh корисно), инвертер {inv} kW. Димензионирано за најлошиот месец ({month}).',
    recTextNoBattery: '{panels} × {wp} W = {kWp} kWp, без батерија (0 денови автономија), инвертер {inv} kW. Димензионирано за најлошиот месец ({month}).',
    recButton: 'Провери го овој систем →',
    passTitle: 'СИСТЕМОТ ГИ ПОМИНУВА ПРОВЕРКИТЕ',
    passText: 'Во најлошиот месец ({month}) системот ги поминува сите проверки подолу (врз основа на месечни просеци).',
    failTitle: 'СИСТЕМОТ НЕ ГИ ПОМИНУВА ПРОВЕРКИТЕ',
    failText: 'Во најлошиот месец ({month}) барем една проверка паѓа — види детали подолу.',

    // checks
    checksTitleSize: 'Како е изведена препораката (најлош месец)',
    checksTitleCheck: 'Детална проверка (најлош месец)',
    chkDaytimeTitle: '1. Дневно покривање во најлош месец ({month})',
    chkDaytimeDetail: 'производство {lhs} kWh/ден {op} дневна потрошувачка {rhs} kWh',
    chkDaytimePass: 'Соларот ја покрива дневната потрошувачка во најлошиот месец.',
    chkDaytimeFail: 'Соларот не ја покрива ни дневната потрошувачка во најлошиот месец.',
    chkDaytimeSize: 'Услов А: доволно панели за дневната потрошувачка.',
    chkRechargeTitle: '2. Дневен вишок за полнење на батеријата',
    chkRechargeDetail: 'вишок {lhs} kWh {op} потребно полнење {rhs} kWh (ноќна потр. ÷ ефикасност)',
    chkRechargePass: 'Дневниот вишок е доволен за да се наполни она што се троши ноќе.',
    chkRechargeFail: 'Дневниот вишок не е доволен за да се наполни батеријата секој ден.',
    chkRechargeSize: 'Услов Б: доволно панели и за полнење на батеријата.',
    chkNightTitle: '3. Батеријата ја покрива потребата (ноќ + автономија)',
    chkNightDetail: 'корисен капацитет {lhs} kWh {op} потребно {rhs} kWh',
    chkNightPass: 'Инсталираната батерија е доволна.',
    chkNightFail: 'Инсталираната батерија е премала.',
    chkNightSize: 'Батеријата е димензионирана точно на потребниот корисен капацитет.',
    chkNa: 'Не се применува — 0 денови автономија (без батерија).',

    // metrics
    mSystemRec: 'Систем (препорака)',
    mSystemYours: 'Твојот систем',
    mSystemSub: '{panels} панели × {wp} W · најлош месец: {month}',
    mAnnual: 'Годишно производство',
    mAnnualSub: 'збир на 12 месеци',
    mCoverage: 'Теоретско годишно покривање',
    mCoverageSub: 'горна граница — не е самодоволност',
    mCoverageTip: 'Годишно производство ÷ годишна потрошувачка, ограничено на 100%. Не го зема предвид времето: летниот вишок не може да го покрие зимскиот дефицит, а дневното производство не може да ја покрие ноќта без батерија. Вистинската самодоволност е пониска.',
    mBatUsable: 'Батерија потребна (корисно)',
    mBatUsableSub: 'ноќ + {extra} дополнителни денови',
    mBatGross: 'Батерија потребна (номинално)',
    mBatGrossSub: 'со корекција за DoD',
    mBatInstalled: 'Инсталирана батерија',
    mBatInstalledSub: '{usable} kWh корисно при DoD {dod}%',
    mInverter: 'Препорачан инвертер',
    mInverterSub: 'пресметано {raw} kW → стандардна големина',

    // formula labels
    formula: '📐 Формула',
    fFormula: 'Формула',
    fSubst: 'Замена',
    fResult: 'Резултат',
    fCondA: 'Услов А',
    fCondB: 'Услов Б',
    fRec: 'Препорака',
    fWorst: 'Најлош месец',
    fSum: 'Σ месечно_производство',
    fSumSubst: 'збир на сите 12 месечни вредности',
    fPanelsA: 'панели ≥ дневна_потр. ÷ (kWh/kWp/ден_најлош × Wp ÷ 1000)',
    fPanelsB: 'панели ≥ (дневна_потр. + полнење) ÷ (kWh/kWp/ден_најлош × Wp ÷ 1000)',
    fPanelsMax: 'панели = max(А, Б)',
    fKwp: 'kWp = панели × Wp ÷ 1000',
    fCoverage: 'min(произв., потр.) ÷ потр. × 100',
    fUsable: 'корисно = ноќна_потр. + (денови − 1) × дневна_потр.',
    fUsableZero: 'денови = 0 → нема батерија',
    fGross: 'номинално = корисно ÷ DoD',
    fInstalled: 'корисно = инсталирано × DoD',
    fInverter: 'AC ≥ max(врвно_оптоварување, kWp ÷ DC/AC)',
    fInverterRound: 'заокружи нагоре на: {sizes} kW',
    fPvgis: 'E_m = месечна енергија за 1 kWp од PVGIS PVcalc (загуби 14%, вкл. хоризонт)',
    fOrientation: 'f(тилт, d) = a + b·cos(d) + c·cos(2d), d = отстапување од југ',
    fNightWrap: '24 − почеток + крај',
    fNightPlain: 'крај − почеток',
    fShareProp: 'удел = ноќни_часови ÷ 24 × 100',
    fShareUser: 'удел = внесено од корисник',
    fNightKwh: 'ноќна_потр. = дневна_потр. × удел',
    fCharge: 'полнење = ноќна_потр. ÷ ефикасност',
    fSurplus: 'вишок = дневно_произв._најлош − дневна_потр.',
    fRefill: 'денови = резерва ÷ ефикасност ÷ преостанат_вишок',

    // chart / table
    chartTitle: 'Месечно производство наспроти потрошувачка',
    chartProd: 'Производство (kWh)',
    chartCons: 'Потрошувачка (kWh)',
    tableTitle: 'Месечна табела',
    thMonth: 'Месец',
    thProd: 'Производство kWh',
    thCons: 'Потрошувачка kWh',
    thDaily: 'Дневно произв. kWh/д',
    thBalance: 'Вишок / Дефицит',
    thStatus: 'Статус',
    surplus: 'Вишок',
    deficit: 'Дефицит',

    // battery steps
    stepsTitle: 'Пресметка на батерија — чекор по чекор',
    stNightTitle: 'Ноќен прозорец',
    stNightText: 'Од {start} до {end}{wrap} → <span class="sval">{hours} часа</span>',
    stWrap: ' (преку полноќ)',
    stShareTitle: 'Ноќна потрошувачка',
    stShareText: 'Удел ноќе {share}% → <span class="sval">{night} kWh</span> ноќе, {day} kWh дење',
    stUsableTitle: 'Потребен корисен капацитет ({days} ден/а автономија)',
    stGrossTitle: 'Со DoD {dod}% → потребен номинален капацитет',
    stChargeTitle: 'Енергија за полнење дневно (ефикасност {eff}%)',
    stRechargeTitle: 'Дали дневниот вишок ја полни батеријата во најслабиот месец ({month})?',
    stRechargeText: 'Дневен вишок: <span class="sval">{prod} − {day} = {surplus} kWh</span> · Потребно полнење: <span class="sval">{charge} kWh</span>',
    stYes: 'ДА',
    stNo: 'НЕ',
    stReserveTitle: 'Полнење на резервата за автономија',
    stReserveText: 'Резерва {reserve} kWh, преостанат вишок во {month}: {leftover} kWh/ден → <span class="sval">{days}</span>',
    stReserveDays: '≈ {n} дена',
    stReserveNever: 'не се полни во {month} (се полни во посончеви месеци)',
    stNoBattery: '0 денови автономија — батерија не се димензионира; ноќната потрошувачка оди од мрежа.',

    footer: 'Резултатите се засноваат на месечни просеци и служат за првична процена. Не се моделираат засенчување, облачни периоди и температура (освен загубите вградени во PVGIS). За конечен дизајн консултирај се со лиценциран PV инсталатер.',
    hoursUnit: 'ч',
  },
};

const MONTHS = {
  mk: {
    short: ['Јан', 'Фев', 'Мар', 'Апр', 'Мај', 'Јун', 'Јул', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'],
    full: ['Јануари', 'Февруари', 'Март', 'Април', 'Мај', 'Јуни', 'Јули', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'],
  },
};

let current = 'mk';

export function getLang() {
  return current;
}

export function setLang(lang) {
  if (STRINGS[lang]) current = lang;
  return current;
}

export function t(key, params = {}) {
  const dict = STRINGS[current] || STRINGS.mk;
  const s = dict[key] ?? STRINGS.mk[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

export function monthName(i, kind = 'full') {
  return (MONTHS[current] || MONTHS.mk)[kind][i];
}
