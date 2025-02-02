const zigbeeHerdsmanConverters = require('zigbee-herdsman-converters');

const exposes = (zigbeeHerdsmanConverters.hasOwnProperty('exposes'))?zigbeeHerdsmanConverters.exposes:require("zigbee-herdsman-converters/lib/exposes");
const ea = exposes.access;
const e = exposes.presets;
const fz = zigbeeHerdsmanConverters.fromZigbeeConverters || zigbeeHerdsmanConverters.fromZigbee;
const tz = zigbeeHerdsmanConverters.toZigbeeConverters || zigbeeHerdsmanConverters.toZigbee;
const reporting = require('zigbee-herdsman-converters/lib/reporting');
const utils = require('zigbee-herdsman-converters/lib/utils');
const {logger} = require('zigbee-herdsman-converters/lib/logger');

const ZCL_DATATYPE_UINT16 = 0x21;
const ZCL_DATATYPE_UINT32 = 0x23;

const ACCESS_STATE = 0b001, ACCESS_WRITE = 0b010, ACCESS_READ = 0b100;

const bind = async (endpoint, target, clusters) => {
    for (const cluster of clusters) {
        await endpoint.bind(cluster, target);
    }
};

const time_to_str_min = (time) => {
    const date = new Date(null);
    date.setSeconds(time); 
    result = date.toISOString().slice(11, 16);		  
    return result;
};

const str_min_to_time = (str_min) => {
    result = str_min.slice(0, 2) * 60 * 60 + str_min.slice(3, 5) * 60;
    return result;
};

function EndpointByKey(key) {
    let endpoint = 0;
    switch (key) {
        case 'sensor': 
            endpoint = 1;
            break;
        case 'day_output': 
            endpoint = 2;
            break;
        case 'night_output': 
            endpoint = 3;
        break;
        default: 
            break;
    }
    return endpoint;
}

const fz_local = {
    ps_on_off: {
        cluster: 'genOnOff',
        type: ['attributeReport', 'readResponse'],
        convert: (model, msg, publish, options, meta) => {
            const result = {};
            const endpoint = msg.endpoint.ID;
            let property = '';
            switch (endpoint) {
                case 1: 
                    property = 'sensor';
                    break;
                case 2: 
                    property = 'day_output';
                    break;
                case 3: 
                    property = 'night_output';
                    break;
                default: 
                    break;
            }
            const state = msg.data['onOff'] === 1 ? 'ON' : 'OFF';
            result[property] = state;
            return result;
        },
    },
    illuminance_config: {
        cluster: 'msIlluminanceMeasurement',
        type: ['attributeReport', 'readResponse'],
        convert: (model, msg, publish, options, meta) => {
            const result = {};
            if (msg.data.hasOwnProperty(0xF001)) {
                result.illuminance_threshold = msg.data[0xF001];
            }
            if (msg.data.hasOwnProperty('measuredValue')) {
                const illuminance_raw = msg.data['measuredValue'];
                const illuminance = illuminance_raw === 0 ? 0 : Math.pow(10, (illuminance_raw - 1) / 10000);
                result.illuminance = illuminance;
                result.illuminance_raw = illuminance_raw;
                }
            return result;
        },
    },
    time_config: {
        cluster: 'genTime',
        type: ['readResponse'],
        convert: (model, msg, publish, options, meta) => {
            const result = {};
            if (msg.data.hasOwnProperty('dstStart')) {
                result.min_time = time_to_str_min(msg.data.dstStart);
            }
            if (msg.data.hasOwnProperty('dstEnd')) {
                result.max_time = time_to_str_min(msg.data.dstEnd);
            }
            return result;
        },
    },
    local_time: {
        cluster: 'genTime',
        type: ['attributeReport', 'readResponse'],
        convert: (model, msg, publish, options, meta) => {
            const result = {};
            if (msg.data.hasOwnProperty('localTime')) {
                result.local_time = time_to_str_min(msg.data.localTime);
            }
            return result;
        },
    },
    led_config: {
        cluster: 'genOnOff',
        type: ['readResponse'],
        convert: (model, msg, publish, options, meta) => {
            if (msg.data.hasOwnProperty(0xF004)) {
                result = ['Always', 'Never', 'Night'][msg.data[0xF004]];
            }
            return {led_mode: result};
        },
    },
    distance: {
        cluster: 'msOccupancySensing',
        type: ['attributeReport', 'readResponse'],
        convert: (model, msg, publish, options, meta) => {
            const result = {};
            if (msg.data.hasOwnProperty(0xF005)) {
                result.target_distance =  msg.data[0xF005];
            }
            if (msg.data.hasOwnProperty(0xF006)) {
                result.target_type = ['None', 'Moving', 'Stationary', 'Moving and stationary'][msg.data[0xF006]];
            }
            if (msg.data.hasOwnProperty(0xF007)) {
                result.measurement_period = msg.data[0xF007];
            }
            return result;
        },
    },
};

const tz_local = {
    ps_on_off:{
        key: ['sensor', 'day_output', 'night_output'],
        convertSet: async (entity, key, value, meta) => {
            const state = utils.isString(meta.message[key]) ? meta.message[key].toLowerCase() : null;
            utils.validateValue(state, ['toggle', 'off', 'on']);
            
            await meta.device.getEndpoint(EndpointByKey(key)).command('genOnOff', state, {}, utils.getOptions(meta.mapped, entity));
        },
        convertGet: async (entity, key, meta) => {
            await meta.device.getEndpoint(EndpointByKey(key)).read('genOnOff', ['onOff']);
        },
    },
    illuminance_config: {
        key: ['illuminance_threshold'],
        convertSet: async (entity, key, value, meta) => {
            value *= 1;
            const firstEndpoint = meta.device.getEndpoint(1);
            const payloads = {
                illuminance_threshold: ['msIlluminanceMeasurement', {0xF001: {value, type: ZCL_DATATYPE_UINT16}}],
            };
            await firstEndpoint.write(payloads[key][0], payloads[key][1]);
            return {
                state: {[key]: value},
            };
        },
        convertGet: async (entity, key, meta) => {
            const firstEndpoint = meta.device.getEndpoint(1);
            const payloads = {
                illuminance_threshold: ['msIlluminanceMeasurement', 0xF001],
            };
            await firstEndpoint.read(payloads[key][0], [payloads[key][1]]);
        },
    },
    time_config: {
        key: ['min_time', 'max_time'],
        convertSet: async (entity, key, value, meta) => {
            const firstEndpoint = meta.device.getEndpoint(1);
            value = str_min_to_time(value);
            const payloads = {
                min_time: ['genTime', {0x03: {value, type: ZCL_DATATYPE_UINT32}}],
                max_time: ['genTime', {0x04: {value, type: ZCL_DATATYPE_UINT32}}],
            };
            await firstEndpoint.write(payloads[key][0], payloads[key][1]);
            return {
                state: {[key]: time_to_str_min(value)},
            };
        },
        convertGet: async (entity, key, meta) => {
            const firstEndpoint = meta.device.getEndpoint(1);
            const payloads = {
                min_time: ['genTime', 'dstStart'],
                max_time: ['genTime', 'dstEnd'],
            };
            await firstEndpoint.read(payloads[key][0], [payloads[key][1]]);
        },
    },
    local_time: {
        key: ['local_time'],
        convertSet: async (entity, key, value, meta) => {
            const firstEndpoint = meta.device.getEndpoint(1);
			const time = Math.round(((new Date()).getTime() - (new Date().setHours(0, 0, 0))) / 1000);
            await firstEndpoint.write('genTime', {localTime: time});
            return {state: {local_time: time_to_str_min(time)}};
        },
        convertGet: async (entity, key, meta) => {
            const firstEndpoint = meta.device.getEndpoint(1);
            await firstEndpoint.read('genTime', [0x0007]);
        },
    },
    led_config: {
        key: ['led_mode'],
        convertSet: async (entity, key, rawValue, meta) => {
            const ledModeLookup = {
                'Always': 0,
                'Never':  1,
                'Night':  2,
            };

            const thirdEndpoint = meta.device.getEndpoint(3);

            value = ledModeLookup.hasOwnProperty(rawValue) ? ledModeLookup[rawValue] : parseInt(rawValue, 10);
            const payloads = {
                led_mode: ['genOnOff', {0xF004: {value, type: 0x30}}],
            };
            await thirdEndpoint.write(payloads[key][0], payloads[key][1]);
            return {state: {[key]: rawValue},
            };
        },
        convertGet: async (entity, key, meta) => {
            const thirdEndpoint = meta.device.getEndpoint(3);
            await thirdEndpoint.read('genOnOff', [0xF004]);
        },
    },
    distance: {
        key: ['measurement_period'],
        convertSet: async (entity, key, value, meta) => {
            const firstEndpoint = meta.device.getEndpoint(1);
            value *= 1;
            const payloads = {
                measurement_period: ['msOccupancySensing', {0xF007: {value, type: ZCL_DATATYPE_UINT16}}],
            };
            await firstEndpoint.write(payloads[key][0], payloads[key][1]);
            return {
                state: {[key]: value},
            };
        },
        convertGet: async (entity, key, meta) => {
            const firstEndpoint = meta.device.getEndpoint(1);
            const payloads = {
                measurement_period: ['msOccupancySensing', 0xF007],
            };
            await firstEndpoint.read(payloads[key][0], [payloads[key][1]]);
        },
    },
};

const device = {
	zigbeeModel: ['Presence_Sensor_v2.6'],
	model: 'Presence_Sensor_v2.6',
	vendor: 'Bacchus',
    description: 'Bacchus presence sensor with illuminance',
	supports: 'on/off, occupancy, illuminance', 
	fromZigbee: [	fz_local.ps_on_off, 
					fz.occupancy, 
                    fz_local.illuminance_config,
                    fz_local.time_config,
                    fz_local.local_time,
                    fz_local.led_config,
                    fz_local.distance
    ],
	toZigbee: [tz_local.ps_on_off,
               tz_local.illuminance_config,
               tz_local.time_config,
               tz_local.local_time,
               tz_local.led_config,
               tz_local.distance,
            ],
	meta: {
		multiEndpoint: true,
	},
	configure: async (device, coordinatorEndpoint) => {
		const firstEndpoint =  device.getEndpoint(1);
		const secondEndpoint = device.getEndpoint(2);
		const thirdEndpoint =  device.getEndpoint(3);

        const overrides = { min: 0, max: 3600, change: 0 };

        await reporting.bind(firstEndpoint, coordinatorEndpoint, ['genOnOff', 'genTime', 'msOccupancySensing', 'msIlluminanceMeasurement']);
        await reporting.onOff(firstEndpoint, overrides);
		await reporting.illuminance(firstEndpoint, overrides);
		await reporting.occupancy(firstEndpoint, overrides);

        await reporting.bind(secondEndpoint, coordinatorEndpoint, ['genOnOff']);
        await reporting.onOff(secondEndpoint);

        await reporting.bind(thirdEndpoint, coordinatorEndpoint, ['genOnOff']);
        await reporting.onOff(thirdEndpoint);

        await firstEndpoint.read('msIlluminanceMeasurement', [0xF001]);
        await firstEndpoint.read('genTime', ['dstStart']);
        await firstEndpoint.read('genTime', ['dstEnd']);
        await firstEndpoint.read('msOccupancySensing', [0xF007]);
        await firstEndpoint.read('genOnOff', ['onOff']);

        await thirdEndpoint.read('genOnOff', [0xF004]);

        },

	exposes: [
			e.occupancy(), 
			e.numeric('illuminance_raw', ACCESS_STATE).withDescription('Measured illuminance for threshold'),
			e.numeric('illuminance', ACCESS_STATE).withDescription('Measured illuminance in lux').withUnit('lx'),
			e.numeric('illuminance_threshold', ACCESS_STATE | ACCESS_WRITE | ACCESS_READ).withValueMin(0).withValueMax(50000).withDescription('Illuminance threshold'),
            e.text('local_time', ACCESS_STATE | ACCESS_READ).withDescription('Current time'),
			e.text('min_time', ACCESS_STATE | ACCESS_WRITE | ACCESS_READ).withDescription('Day start'),
			e.text('max_time', ACCESS_STATE | ACCESS_WRITE | ACCESS_READ).withDescription('Day end'),
            e.enum('led_mode', ea.ALL, ['Always', 'Never', 'Night']).withDescription('Led working mode'),
            e.numeric('target_distance', ACCESS_STATE).withUnit('cm').withDescription('Movement target distance'),
            e.enum('target_type', ACCESS_STATE, ['None', 'Moving', 'Stationary', 'Moving and stationary']).withDescription('Target type'),
            e.numeric('measurement_period', ea.ALL).withUnit('sec').withDescription('Distance mesurment period'),
            e.binary('sensor', ea.ALL, 'ON', 'OFF').withDescription('Enable sensor'),
            e.binary('day_output', ACCESS_STATE | ACCESS_READ, 'ON', 'OFF').withDescription('Day binding output'),
            e.binary('night_output', ACCESS_STATE | ACCESS_READ, 'ON', 'OFF').withDescription('Night binding output'),
            
			],
	icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAoAAAAKACAMAAAA7EzkRAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAMAUExURQAAAFxaV2BeWWViXGppZmxtcW9wc3BuaXBvcHRybHl5dnh8gX6AfH6Bg4B+a4B+eYmFa4aGeo6QfZKMa5KMcZiRbpWRcpGRfpyVdZyWeJ+Ydp2Ye6GadqSceqiffaege6qifK+ofbGmfbOrfbiufLewfruyfcC2fcK5fci9eIeIh4uNkY6QiY6RlZCOi5OUgpOSi5eYhZaYi5iWhpiWipyahJ2bi5OUk5KVm5WYlZWYm52ck5ydm42So5mcop6gjp6gm52hpZ6jsKGchaCdiqCek6CepaSghaShjKukgqymiq6ohK6oi6SilKOjm6WonaimlKimmquplayqm6+wnbGqhLKri7iug7OtkrGunLewg7awjbuzgruzi7+4hr64jLawk7WxmrmzlLm0m764k724naSmpqess62wq6ewva2xtKyyu7CuorOypLOzq7a4pra4q7q2obi2qr25o7y6q7K1s7G1u7W4tLS5u7i3s7u7s7q8u6y0wrG2wbS6w7S8yrm+w7i+ybO90b7Atb3AvLfAzL3Bw7zCy7vF1sC2gsC2isO6hMS8i8i+hcm+i8C3k8O8ksK8m8i+ksG8pMG9q8G+scK/u8bAjsnAhsvCjMbAk8bAm8zDk8vEms7Ilc7Im9DGldDGmtHJldLKm9nNnsXBo8PBrcrFo8rFqs7Io87Jq8XDs8TEu8bItMbIvcjGs8jGuszLtMzLu87QvtPMotPNq9HOtNDOu9bQpdbQqtjSptjSq93apN7arNPQtdTTutfYu9nUs9rVutzYtdrZveHen+HepOHeq+DdsuHbveLgpOThq+ThtOXivOjltMLFw8HGysXIxMXJzMjHwMrLw8vNy8DG0cHH28TJ0sLK2srN0sjO2c7Qw87QzcfQ3M3R0s3S2tDOwtDOytPSwtLTy9bYzdjWwdjWyd3cwtzbzNLU09LW2tbY1dXY29nX09jX2dna1Nrc3Nnc4d7gw97g4uDdxODey+Lhw+HgzeDh4gAAAAAAAAAAAAAAAAAAAAAAANGE3/AAAAEAdFJOU////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wBT9wclAAAACXBIWXMAAAsSAAALEgHS3X78AAAAGXRFWHRTb2Z0d2FyZQBwYWludC5uZXQgNC4wLjIx8SBplQAAfelJREFUeF7tvXtgVfWZ7v/rtJ2OqGPpTKe2ltYZe6gHQdFKEJKDQaAiNRGhUJhCK1B3MAhVIUC5O2UAC1UoeBQFbygXkxKyAwGkJRCZVtrO4WLiYISCJIUA0mPrgJ6/9u953vdda6+dCyThsrP3+j77mvsm+fB53/e71l77/4u5uCQxDkCXpMYB6JLUOABdkhoHoEtS4wB0SWocgC5JjQPQJalxALokNQ5Al6TGAeiS1DgAXZIaB6BLUuMAdElqHIAuSY0D0CWpcQC6JDUOQJekxgHoktQ4AF2SGgegS1LjAHRJahyALkmNA9AlqXEAuiQ1DkCXpMYB6JLUOABdkhoHoEtS4wB0SWocgC5JjQPQJalxALokNQ5Al6TGAeiS1DgAXZIaB6BLUuMAdElqHIAuSY0D0CWpcQC6JDUOQJekxgHoktQ4AF2SGgegS1LjAHRJahyALkmNA9AlqXEAuiQ1DkCXpMYB6JLUOABdkhoHoEtS4wB0SWocgC5JjQPQJalxALokNQ5Al6TGAeiS1DgAXZIaB6BLUuMAdElqHIAuSY0D0CWpcQC6JDUOQJekxgHoktQ4AF2SGgegS1LjAHRJahyALkmNA9AlqXEAuiQ1DkCXpMYB6JLUOABdkhoHoEtS4wB0SWocgC5JjQPQJalxALokNQ5Al6TGAeiS1DgAXZIaB6BLUuMAdElqHIAuSY0D0CWpcQC6JDUOQJekxgHoktQ4AF2SGgegS1LjAHRJahyALkmNA9AlqXEAuiQ1DkCXpMYB6JLUOABdkhoHoEtS4wB0SWocgC5JjQPQJalxALokNQ5Al6TGAdh4qv9cW/vnmpqazTU1teW4rT1x/MMT9jGXixgHYGLqTpa/XVleu73u2LFjdcdOHKurO1F3QnL2xPs1NXW1tWcqTp60T3a58DgALSdqa46V7wR4dWTv2HGAd9xjDzd2jzn7Ye2xozUnT9baV7pcSByAyCe7j328u+5snehO2OOtuE+uYD8hT07+W59UoDC7snyBCTuAZz/8+A+7686cOaP0wX4wH07CnYrv7Flwxyh5uNLziROfnD1xrPbYiQ/te7m0IqEG8OyZM7vAHukjfGQQ18beibqzZ4w8Lx9+8onAqGdc8fqTs4TwuH1LlxYmxADWHdu1i9Axx2hA9HzHzpw4cUbQqwffJ4zefHhWz7g6e+KTD0+cwJ0TJzEm2/d1aUlCCuCHmzdv5qzh5Yx0fupB+q0hfH7oPHwGCDz7ISox3sRY8gnu80vt27s0O2EEsLKisryCEfTUgJhAeIH+zp6tU+68GHj1QgaJonaDJBYqrDlR6xhsWUIH4NnCsnLiJ+LbfUzWXE7AgGdZeclfAn5GW8PAeKzCn5yA/+T0IU7MsRMn3PpMCxIyAKObNm8W9xmCXParowR1DQYEnjH0mmZPI/YjfxCfkGeTsaTGDcbNTagA3B7dTPuVAz/SR/9x/uCKH9k7i8nDi2HWdDCDiP+kCWyQuhN/sp/pcu6EB8CashLgV15RTv0pgoQP+jtzpu7s8TMswfEYZo3mQ70S/3EKbjS7jtfZD3Y5V8IC4LHikrKynSy/gp+UX9CHE4fXM8AP1LVEgMZfsPDG8ycMIyeO1548ZT/dpcmEA8DKsrVlgE/aP+EPBJ6poAHpPxRfnOL0IYZZo4EA5UwHog4TwsT8SfirrT1eW1PrFgfPkzAAWFn0elk59KfTr57Q+3H5Bfyd4IY4QtcC/2nUgfVq8J9wEv5OAMDjtbV1biY+Z9IfwMqS4jIEvZ9G7FdXsVv6P0wLQl+C/4yvpmItILeGiPzqGdD0RwK9uJm46aQ9gMVRwc/4o/3O7Kqr4OiLHpDyk/ob9F9zBMjiS//VFyD9BwIFQdZgS42biZtKmgMYfR2zR9nOiu2cfjVkkIsvECDGX+3/WogfJchNwSdUgXEGUX1pvhN/AnQ+fZKaGntELolJawDLXyV+6P62+/Bp68f6y/Vn1l+PPrnmlt7z5wSX/oDfWW4AYfRa8WPvVw+/o7WHDh2qcpW4saQzgK9L87dz5+adxh8J3LX72G7OHrAf668RiBN3MSCCn3xsmDURjr/cDifrLx9yC7DQx2u2f38K9H7I0dqqqirAV8VzpdNgg6QvgNG1pr+dnv8qKuoqIL+6YzoAK34yfwh/uAV851GgbALG55zgLjBCHqP0iQETcpTs1dbiGvwd5eWIPToXS7oCWIPmbxP1hwbQyzHwh/GDO0B7+MlF0DvDsxgwHrzBd9n7PjzxIfDjewAcWkAFT8+k7yTp+1Og+AK/2pO11dXVILC6qrqK56rKCleJg0lTAKE/4Fe2c3tZhS/AXWJAnM8cw/yhCAp9okEY8JOzEKAgR/SsJFs+OYvGD++i79D+JW7++LD2xMnjYO9Pf64FcVJ3jx5F5a09CejwdtXJQ1WHjlYdPnqUHO6rPGSP0iVdASzW7m/79p0VAQHu3rVbtn3I+Ev8EHNg3IACW/1g7vCW+/wdAL18IEt+J4Q8yUnW3cOHa0Fd1Ukx4MmqwyeP8ox31h6mCo/aA3VJRwD3Rqm/7Tu379wZ6P927dIaLPAZfx5+uBEDNhVw5+33lxiAx2U/DRFEkUWzd7Kaw8dJ4HdUDHj4qFVg1mO8G59U6xiUpCGAZWs3sfsDfoYes2vXLgpQ9v1j+Q0YkEX4k0+AoLJozAUC+8XBi08egh/PFoivugqaOwrj1R6qPkkYcRfMHcaVnA9XHz2Mt6vBYHWV22mQSTsAa7aulfLLEyqw4Vexm5djFbt3ySaQgAFFf7gAQZwaaJCcEb/66tM1lyB+nHHR+FUfrT4KB2LwqD7MIszBw8K7oPAoETx88vDJKvfc9vQDsGQthw/lD+TFCYQA63aJ/7wBxAsNqGdoUBSoFhTMbO5oyN9xXXCWCF6AD3hx4YWuA2WKW1X1IeDGwHonccO3iCA8iHd9+H/tgYc1aQZgydqyYtbfMtbfeAnevWuXtH/ivyB+1J/CR+wInl5L26c3jdMX2NIh7Bl+5ju5IWZAjPnzyQ8+PPnBSVw++BD3JKjHoPPk/qN/sccezqQXgBu1/aP/KgITMP1XcYb87TqzG8TVR9AzoE/fGe6gr6w1pE97PyMQoJE9idyh9HCtfgN5J/8i+e+//D87aU6fEgoPVXEyDvN+q+kE4PubXmf93U4EgxMI/Icz94KxKHqIJ0Be9IZ3eHwEuO9s3VnvIAmBoPU7Ljv6cbmP3V4jqT5EuP784YdGG/LhXz6sF74Tn1VbC2CPhvd4W2kEYPnatZu43z3w4/ThC1D8B/XhbPTVawGNPz0JfNAfdxXUs95aID+v+hpt9aNl1+DDDVjTnaNxquEFd5DjSqHU40OHDlSftn9F2JI+AJYVr6X/duKcsP4M+IAgWkCZQlh/E/hDiKDegjTcKHLx2kv8eKmtqz1epzDVHq1sXH5C358BFsH7M0mrqakEeI2mtvaEYAgPHqoKqQTTBsDipZvQ/20y/wUKsPR/dZDfMZivIX0aYRAfO8s9BL2zdwJ+mDpO1GD4+JM2f5VVlcCv0qDzw/U9oU9ra+1BUoarg7yqKcepYcgoPr/20KHqUCKYLgCi/Mr6Hwyo/HkIcvkPCqzYvRtTSB1GkMYJlGdl4uJVXDkLezzYQS3oO36C5mMBfR/8VVUCv0QCuYkD+H2g8NUcPFh5EOQRvnIJCfQSZJHftPYDfM2BavvHhClpAuAa8scBmJvfAkswrL5QILk7tssM2CiBrL1qPnGfnonfcfBXQwZrao/VHgd/xK6ycfz+/GfQR/gOHQR4jOFG/cl90SDv4y3eesF35xeGcBtxegC4dO2m14U/CjC++RfRCZhXgE+PRKnEBXOWhZlokjuJwofbY3VCXy0MKKp6n/J7Ww3IU9XbcfxEfTVH36+Upq+yvLS8VIGzxAWIKIRxBqlBSDB0ZTgtAET99fmD/hJaQHSAKLxoATkEiwEbRvA7S+qAnLAn96C/OlTfY8dr6mrriF/N0cqjkB/ydmXVfuC3jwha8aXBwF4l+73yqDDGK038rlC3Q98B7uTKQgIPVYdsUTAdAHxtraz/2fwboM/0t3tXRd2u3aI4wy0e8R0MiOmDcNKAdgF/x+qOH6tD4aX6uH5CvirhPBhwHzS4T+QXxw9WBEaVNaXAy8SXeLVDrnCSa303rhU/CQkM14JMGgC4RvgTBAFgPQRhQC6+CF1nZFtwIwoUA4r/fPxAn55qjx+rqTmm+KH+iv2I4H4WX/iP+AG+o/jQ+6SPVKH41g+hw8d2lO8SAuV6R/kx3AiCBuFBIfBAmCSY+gCK/4DfNviPm0Di+MkAcqZi9xlI8MyZ3bsMvQCDJI5v2q2gRxDFfqDv2DHUXltENvqqUH0r97y9/23OIVVHdT9U0oeZt/JgebTmoBovmB07AJxchD3vhA/sIpRsBw1BlG98u/cO278tBEl5AJeCvxISyPYvYReEXSjBLMJqQD0aObcEx+OBKOTpyXJc7Hf8uLiPkeor9qvc//Y+UqjVl/Sx9L6PM4g6KMAlZMcuomYXcMfgffi/wQ/sYCVWPeoPEgtWV9m/Lv2T6gCuVv68ASSIIFq/XVyABnRKn+CnF14HzeeHCjyGzo/PH67BBAwiOPvScMQP2ff2PuhPqq9sDca7DtZwya8Ug29CdpRXkD6DrpEAzvIKapAUijeVwIMhIjDFASzx/IcCjAQaQG7/hfyAH7AS7ggdg1u8Q7bKycW40xuZO4TB2mM1OAM/X3/I2/vertrjLb0cZekFmTUwYLkOvsYR4SNhO8R15wwYBKI7dqAdxE9SBOHAqrAsSqc2gCVr13r9HzpA7oTv9YDc9qH0mf00CiHA0xUZxc4CCMV8fLUaHj6wBvgxGD6EPfgPHeA+3OyH/vikD777IPgDN9L5GXyI8tesqCQTh2K2ggfs35jmSWkAC9cIf9wHUDYCSwG2oPs7s4urLz52Fr5B9uSmQY6DQFpQzCf+i+OHqz17ZASW4B20X81mDL0ovv7k2yh8dXbbeNAP7qjgUBxH8FBICExlADevRQHmLgjAT7bBQX4qQC79yf5XLLUJ+CHydiMGlLlXrxHzn1bft0V/4I9LMJw/OBLzQ+AvSvriIU+YeAORb277In7kZ9dH9mHJDvKnEwlFKj+6NhRVOIUBLF+2hvBZAVb/+QVYVl3wVxfk6odbhaUHTIzQV4f2L44fIItWRs1+b+/BDfnjZjjmfdAXjdddpF7T9xGQs2+OfFT3kdHIDyUSKF8Hee6oAYhC4MGaQ2EgMIUBLJYCvGnTtrJt3AlfOkDSx/J7pgLTb0L3lxCpwMKCxdjjKYif+G/D22/jDPrAn0y/it/7lQejtB+3e1hkrvXz0UfiPWCnJ14BQZw++ujjj3d9DDyDFGIakWZQm0n8+NqaMEwiqQvg0jWyAA0HchtcgD+0VPQbt/zWa/+88CMKXiA+fzWJ+iN81B/9R/4IH/J+5WbIL1B9gZ5Pn/KmFdfjT1D8qO7jjz/WDxFG8Kc+9MK1auFPqnBtCHYRTFkAoxiAuQdq2aZt6AADEwh3fJFKR/4ajfAXJ9DIU/p8/aH7A33Q354NECCuMH7E+cOHAF80PnqAeg8/+aawn0BHCD8W9ADex+BPP0ouPSj5Dv1Kbi3xxmHtA99LewemKoDRNWwAeQZ8xM9bAuT+z1J7m8IPSeCPUf5qgvojY1GgVwT+9vAM7AL8bQaBpQH8AvIjW8YXi62dNHL7MSi0zxD6OKLYVyPcWOdV4RA4MEUBrFwL/oRAdIDxbSDI7mNwH59/2XQC/Jn5eFL91Ql+NZvfB2Ho/fYUbSjaQP0pf5bo+9HNpd7Kc+LkwW9Kqjz+fAI1cis2hAvxbvkUfHa8Ess24ziBNem+WThFAVyLAUQIxAwsO0GbAFl/5QCA50yCAQP8mf3KN2+m4Wg/0ofT2xsMPYRmjG7eHOdPl14QIw43dJxoT5iTk8YMKBfel4qsRdhHkLOw3wcerNlv/+Q0TWoCuAwDiDSAW2HAnYKg1t86Pv9cD37f6PiB4I/t8QdZevzJ9CEElpdj+ohuQPndsKGoiFcQocFH+ui/9/miXxbDhgMF/QeahCzBTu7pKRBDkO+Te/wiXPl1GDWYS9J+FbZ/dHomJQGMviYAItv8DlD7v6Z2uk9M3H/yepk8of+rqaB1yjneIqQP/BXBf0WsvxLhL0r3+QRq+dWaKxHqeIuTMqZ34xH89H28yJfa4xEA8S25IGgEHnQAtrksWbNJASzbWrZtGyuw9H/c85lHYDtPaMAAgjxoTF3FLjVgec37qL/ED9UX/O3ZEOAvqtUX00f99o/fSKZeg4shdsoY7wRjCPK9wqN8oTDoSbBCi7Cca2rS+oCqqQjgWkzAug2OBZiLgEYg+j8e/fTcAaAefrLvAV+5gQ1gBXhi//e+rz/JHr/9i75N/uC/AH7GH7esgSSv+EoENbs0FoAnn8Rr5Y9n4Q/fFWZVA+J8OJ0dmIIAFnsFWPiDALX+ogAfa6rviydRf2TP+JP1FxRg1l/Rn3fS3RAqN2xoCj/wJ4sv1J8AJTceeE3xpx8xBnGyQuxvGSnXPpAGTOtJOAUBRAG2oAMEgp7+dtNsxlkTYX3mOZE+vnhrTYV0gOAPAwi5s8j6C/lT/FiALTCUkEL9oYrWCU0KVHPjG5AXGhDfxh+GTYHl5QdravbaPz0Nk3oArl2zTpdg4L+t22QE1gUYeQHg8yWoP8T3H/VH/kCgTL9FhcKfbAUGfT5/3vCh7tPuT+SlNLU0CqxdhMD45mHbLCdFOH2fKZdyAEaX+gLkEqDXAII/Q+xcSTAg0fP4QwMo9VcKMMkjfxChCPDtt4uiGzz+lED0aBIS4+OHe62AkF+kF2sFbRLhZjl5VNw9NX27wJQDsHDNRluC4UbgTV4BBn/nbQAFvwYGNP9BNPAf+Yv7D0Mw6MM7zICe/7xNH6yYgh/91Rr4EH6VXTjFkOePPAJtNRBFOH33i0k1AFd7E/CmTWgAZSMIAeRr/xpmTUbxw42yh3AKZiqk/par/zaAPuEPAkQBjhatB3/EL+4/T38cfW3lhfiRo1ZEvlq+gxCI6LeXTSI0IJO2T1JKMQAr13AnBMm2TV4HCP9VGGTnCMEjgl688ssBmAQ28B8L8NvRPRveFvqC/pOw+OIs8Ki/Wh1+qXwH6k/3E5SwCQSBZDBtFZhiAC6N8+f5jw0gd3E+bzwDxmMGLOcCtEzA5K+4UA1IAW5AEcadBP684ZcNG5khPERHULqA8JvwmkXYW5C2HVRrWITtN5BuSS0AizGBbCR+W3nBFKwFOLj5wzvcab0AN+Kn4FmsAZR49dcXoGyEexvwKX5RDz8+nxwR/oQZz4AXGPkmQrIMwuJAnUPkKXc1h9L0NUVSC8BJcQGy/MpWOBGgRI703HTUfvYMYMJH/mrUf+Xvvx99X+pvIQQowRt40+dve/l2suCNH2oqMkN4Lpw/RL4Xr8i2EWg1OI0VmFIAlq1Zs26TKpAM0n8iQJl/ffwahRDMeQZUBL0BRP33/ubNmzfIAOLXX7kCf+vJX5kKsEKXX2S9+CIbUNAzpDGKoBPkTwKDRmBNVXo+TTOlAFy5xoNvK+iTzXAAMLj737kkGCzAshVYDFhRUxFYgCn2+JP9sEigxPo/T38UoFqPuFwU/LwYgZ4DuRSN1JSX1qTpjoGpBKBsAyGCWzEC46Qj8O4KW4IW+AS/hgxSe96hd4U9qcG6AFhTA/0pf+o/9oF6iW5YHy3Bh8q0/Or4wS2/tJ9AiJOieFFiBmR9B4G2HCgIgsCqtOwCUwjAShZgVSAJ3CkVGAQqYoQO/H185mNcGg3RkwBCvwBLgeMeqAH/+Qja/FuiCAgO5I/70xt0xOWixgiEA60G4wdzLZCr0WmpwBQCcNOadegAgSBGYBpQKjCPwGaAgT7iZ28kRrFT/yH+CqDsAShb4FByhT+pvIpfIeHDuVQI1PorbtLd7X0DGjsXI0ofDCg7CSYosNwBmNy8v8KbQLbSgJiCxX/xZx9pCcZf0d4OhF2isQcI4/MHKzCfASL8AT/w5xkQKsQEQv7Ky/jn12dd0kvc7Q8nH5iLGp9AnJU/gQ/BHJyOO8WkDoDcCAf8cN66deu2bZu0AvsCBH4ovqCvUQUqebgAvuO+AUGfLMAof4XFJE8FSP5KNqj/dAcsjz/OqKI+0Z/gclEj/JFAtpk+gmwUMAjbryKdkjoAyghMAW5hB7hJ1wDlJUAsgiAujRuQCEr8FUAJt3/IHljFRcVFhR5/wA/3wV9JdHPZdk4gQgLsd4bVUcC7dDEG8Vjlp8rmEPJXWmm/inRKygC4dqUKcAsrMAyIkEDuBWiBABufP2T9z9o/Of6V1wHSf5s3v88FQE7A1v4BP5zWFwp/Uam/0gBSSjwRPzqKdy4NicKf/AhBUOjjJR0VmDIArlwDA1KAWwmgFeB6eyFgBsGpkdgSoIy/Wn7FfuTPCjAGEOBHAqUVLMT8y/WXEll/Ef9x3xfSJ2xcEu686M/QHlAJ9JYD03CPhFQBsHjNSvLHE1vAnbygA+TTgONpfAQGeX4B9vhjgCAGYOOPFRj68+pvUfEG+K+klAef9BZgPt5l3d+lxQ/RnyEU8gfz6VKaPen3BLlUAXAJWkDfgH4L+OY5DsEWjOGHePypAFF/lb+iwmLcSCEWAxZvEANa/8cBRCqu7nvKe5c2ZkA6EAjyacIINwin39OTUgTAYh1BoD81oLaAbyYMIU2Ef0cjkP47HjCgCJDcof+TbW9iP+GvpKQkqusv6j/9BgLfJccPkZ8BCONzsOTgfPt9pE9SBMC1K1dtBH5gcNu2gAF37wYVBtq5ovgwZkBvBVD5Ky5EBWYDSPvxgvqLAlxeGp9/JQLG5eDP4EPkp3u7ZZWXP26/j/RJagBYs/JF4kcDAsJtngG5J8yZcztQqNP4W4CFQNkEYgUY/JFDGpAp0v6vnPVXlv+4UULW5S6bATVKIR6AP4XUpN324NQAcBP8R/xYfrkZhBtCxIC75AW4zleGiQ8TfxacLMH4W+C4Ac7DD1UY1bckWlYuG+AIILfLmvouqwFBH8nnf4FyHURKa96230jaJDUA3LVtixiQa4BwnxgQAMqLcRG/JglU8OLx+QOB3AYs4BXqBKL6QwNYCP+VRFl+1X8qPxkMaMDLF/w4wC/xNgin3UpgSgBY8eZv33hj68Y3tqL/owJJIA2orwRXxyKcWIjtDekPlTwE5MkVCaxANasvQNoP5+JirkDr/s9sAImfrj4LEpcpgntcgfJgkJoa+5WkTVICwB1v/RYEbkMV3sbqq8+HYwmmATmIKILsB+Uqjp+ix7AD9PBj5ChE5O9pbQDNfxxAwJ/uACP1lwwID5fTfvhhvEa4DiMRAMtr0u2QvakA4FkC+JtfvQEG2f/hohW44s3dIJAGNOqEPMOPCaxAI14DeKyCx0GwTSD0nxRgsvc0LsUlxSUluv5iA7D35LfLhx9C3HEB/UqgPqDymtJ0q8GpAOCuNwGgELjlDbInPSBLsBgQJ2T3GS4JSkPIV+gnh/UM6PMnArR9oIutAcToIfgVcQWmZLPsAi3HP8BX0kPk4XITSAPySAn+czQl6bZDQioA+Nu3fv/b3/xGCfT2RdC9Ud/SGozUkUMhUOAjf/Xw8/g7VsFDAdoSNJkz/5E/CpAVWP/W+KPjS0mf8HBZ+SN9YkE8ggB+5Wl3vNQUAPD4m29SgAyrMAQoBIoCOQcjiiEkyGO0gRrRX6AAy/SBMw/EVl6jAwgnYCKXyJ90gDKB8PviS6k/hDa6nJGfhp+LGqxLgenaBKYAgG+99dbvBT/kV29AgbotDvy9iTn4TaInZZi3VohZfXfFBUj2RH/cAEICOYGAOzSAIkDhTwiEAMGf7IJq9VcG4MuuP4TU48fGu0AhMO12yUoBAHdCgL/5nQegCJC7wuD8ZsXON3e9yb+OUKgM8mVaIUNFDwF6akAMHwyPPKo7wZA/CpD8PW38cQuctwUEX/yRvrTWZdafF/nBuPBf6G2Oi6ZZE9j2Aazd9mvW39/9TiD81RsmQKnBb+6GA9/avfsthY8mhADhvt08WrmEyy+qPzkQKg3IvVBVgE+TP8whil9hMQVY5u+CIPwlCz7ixyv9VxBB3RpS4wC8zNn81q9/9atfCYK/+4/f/EoFKCGCb2EUhgNVfdILclkGg2MdrurO6Oxh/OGkKzC6EY78Fcoc/PSygABZf+P+EwiEhySEBkS0BHsKTLNnJrV9ANe8sfu3v/qP3/wGZ1yhCQwa8M2dFW+9ufvNt1CIaUBiqEVYajAxIn90H+jjUdgoQNsIXEz+WICFP7zBJUAeBCah/wMAhsPljmdAbzFQ8CuvdAa8zFmyksuAv//973/3H6jB5E/0x4gBMYqAP0wj1AQNyLOcCJG+CAPMB/B4FA5EjoOg/GECKSJ/akDZBscCTHA9/giB8JCEKPx2nBjPgJXptRDT5gEsnrhyy6/+8Nabv/v173/z+9/9lkuBGz3+tsGAO996E7PIWxVv7X5zN7pBMaB5kJe6il2Aj0t/QLBCBmDjjzVX+kDypwUYkb+xClBWYJJoQIUfsR0SdAwurUyvMbjNA7hmyWvr3njzD7//LU6//z9/+NVG4LfFkyAQlEK8m9MweVP9+fiRP5ZflV8F8JOdsDCCFMsEUswCPGnZMuGPE8h2doD8OsMvefZj9BHII4EBRd8Ygx2AlzVL+WwQEPjbt377h//zh7fe2PjGxi3b3lACd277NWrwWyDwzTchwjdhQVLn47d7F/jj0gvlJ/zRf5yAi4uffroYAiwsXDYJ9VcKMJcAbScsvwAnlT+GDOLR8F8j+JWXptkeWW0dwPKVK9esW7fxjd/+53/+4Q9v/ee2jVs2vrF140bdJswNcnAg+8C3drIJhAdFhILfLhRfnBHAp2sYFeTPr8AUIPwHA662ChzcBxryawP48YoUwoC2S2DU9YCXM9OWLHl5HQjcsu0Pb4HAN7aAwC3btm01AqHAnTgLgjCgDCMAcSdZhP6EP+JnEf6gPwhw2dPFEKDw53eAehAOFmBbAOQluZFHEVwHLC1Pr10C2zqAa5asBH7Mb9/6w1vbcLsFU8jGNzb5DvTWY3jhGewJhdxQrPj5CAp/JeI/tH1agOE/ClD4swlYCCR6STegRP4jBDaFuBJ8ObOEACqB2379Bq7hwDe2bNtie2b9etu2t2hBw48lGNn5ZkUFJMgnLQl+FuJXxvlD+OPN05MQFWCxrsDoBCz7QMsf3iBIWjwDwoHyb4AB0+tpIW0dwBVL1rxI+jbxCoH9pApjEPGq8E7OImJAZhd3VK3QW/KnfzZG9VdSzAkEABZtKNIGUIZgLsEEJuAkbwJJCP8rBHvA9HpiXBsHsHDJ8y9vXEPyjECytwX+27Jxq09gvAjrHd5UyHm7njjabi7bXFa2WfBjAwjlSQFGCZYGEALcbCMI/ad/9TZAIB8F94jxDbi5vPKI/XLSIm0cQLSAPCaHF/jPM+Abb9h6NKrwtm1vEkKUXmXQrkFgOenbWb4dAYEowBxACuE8bgImf9YBogWUbXAqQK2/bceAfClX7QFLYcA9adUEtn0A12xch5MXsPeqSBA9oe6eyvx62843t2EUJnkehPDfdvUfIwYs0QGYBbhQG0BdgWH9lQaQAwjbP5y1+zIGkhf5n4AHgiaQD5AIVqbVGNzGAVy5cuXLAQNu3PgqLqJAPkHkjW0Js7BsFkmMMMiUIcVCYGGxdn1WgFev1m0gshe0N4Ho373t9IA0oFeDo+VptRDYtgGsXLoY8ov7jyF+lCCG4TiBqMH18RPuPAMCP84frL9P+/xNpAFxj/wRPy3A0B+rnjGY7KgBgaAPYHl6bQxu2wCWLKEAEwFEOApveWMjSnCcQEqQhVh2ld65Dext245rDfkrKZP66/nvaeWPAmQFpgA9/vhHbxP0aYgfHpaNwdHy0rRah2nbAK5esnLdqmALyLyK0xuvwoCJBHIQYSWW8/ZtRHD79q04KX9l4j/hb/UynYBJIFpA4LeZR2KT4+Arf6odAyCp0YeCQdgfg9NsHaZtA7hmMQz4cn0CTYFcjInPIRKwJxRuBX5bAZ/Qt4n9X4nWXwzAakArwLgLAZbJKyHJCowaUPFrEwQKg3hQ/lI0phD77aRF2jaAS5dgCAF+DSX4hiDYgEAiuH3n1u3bgCDx49HcyoCg1l8Ch0vxssLVBBB3V69mAZZXgoP+pALLH9wQTH7soQQWAtNsW1wbB/D5lRtfXldfgZiEQaDwV49A2A+d39adar+twA/ld9OmktfLitcWr4XuwByCG/C3lC2gvwJoE7B2gG0FP4ngBwBtY3C0/H377aRF2jaAo59/eeWalzdufBmndTxGqoVtoBoQBMa7QATVl32f4Le1bOt2GLCkDAS+XrwW2pOsLkQXOFEMqB1gmU0gANA6QNGO/f2TG1uL5CqM94Ih6fXEzDYN4IYlwG8VFEgDrpKThdtC5MLY/tG44fOVSJ5E6u+mTa9ver3kdfjP8NNMmjhxIm5kBJbnoe8AgeY//YtfKv4+sdvmhgM5e0B/HWZz+R779aRF2jSAGIJXAkH4b9Uqow83r66SGuzht8XbNxDuU/HptdC36XUJ+VstBC4FdbiZiBFEFqFlCYYBfz6BiP35L2rAnuDXEgbFgOQv0AM6A16uFC95Hvit27iSi9EvbwSFpsBXVwUNqLtmCXl24yMI/ZG/tWtXryV+y5YCQAT+m0gUZQ2QBZgrMLobdBtq/hDyx4fELSHeDoHptU9+mwaQQzAMiEEECgSBCCGkAd9YxU0hGtD3xjY+XRjxADT/+fxRe0uXou8jgeRPBShrMPibyhLMpfVf6+Ib0KvA6fa0uDYN4LLFK1fSgC9zNbqeATe+6q3EbOUmOT5d2KePh/GN8wcCWX8hv0lL1YDsAHFP12BsL0CZQIRA+9Nf5HjFtyX1l7EeUKZg2yPQAXi5spI7Y618eeW6l6URlA7QMyAw9AwI+OSIMXZN/Ql/6zate32dCHDtavBG73HyUAGiAGsFljUYEaC3G+olZTBw27yoAflfROgrjx50PeDlysrFwO/lNatQgWUpxhuDV63awgrszSFbBUGrwQgPZL7R52/N2jWrX1u6bKnwRwXaHVjR2w2GHSCX2lQ39oe/eAkA11L/4fHgzO7AXwd0m+IuXx5dwmVAFGGcdBD2BLiKPaCNIVuBHhH0ovoDguRvHfhb+xoEKNhx9LA7MCD5kxZQO0C2W2JA/dNf1BA8g09vmk8iHw4rcJ29XE304Hv260mLtGkAh6IH5MZgoY8BgVKGX90oDvTGYGLnE8iXk+OJ9L2+bh0M+Nra12C+iRMfBXds/xhWYPInm+EgwI+4GUR0cyn4q5cWeFAfUoIBN7gSfLnyIAFED0gHrkIB5ixsHJoBTYGkzwjctIXyg/42gr516+C/NYLfowwM6AHIAgwCuRlOCrAI8JLYLx6AF2CvmRjyUdGAfg/o1gEvW5ZwGUYJhAQ9Db4K/OhBNIPiP+InFwFwC1/SC/xtgvzWrVuzZs1riPhPANRMwggsE4iuQksDKCOw/dEveoKwtcB/ImS9+AYsjdpvJz3SpgEcLSVY+fPLsIZ7I1gR9vGjCgEfJ5CNG6k/AviaJ8AxY8YIgLziIrTuB8NnwkEu9mrol8iAglxLuAsG9KkAPf6m228nPdKWAdwwRkuwR2BcgWwBYUDQZ0WY6qP9pAEEffCf8kcDKn8QIAg0DUoFBoBchMaflpu62Gld2gqMtJhCsR8lGO8BHYCXK4WLWYJ9/IIKZBl+dYtskCN/dqMG5En50woM/h4EezSgRkYQqcB2ONRLW37rpaUMSv3VHpAERqP77NeTHmnLAEafsiFEEFzlN4GCn64FSoTArbgR9ph1SiD5W4MCvIT0MR6AbAHpPxPgZTBgqwuw6I9V2KvBm10PeLmyYfHi51cEarDhZ8EcvOpVWQmUC1o/3lP+NFKAl762ZCL0pwJUCFmB5bmY3isS8jjgH/MFGdpizIAowcJfNJpeL9vflgEsXhw0IMbgeBPIHvDVVVsgQekCFUPqTzrALT6Ar732/FLyN2b4KN+A8UVAWwPkflhtb0cYidgPEQEagWm1KbiN94AAEAoEfFaEA0EHCAilDeRZbsR+gforHeCSB0Ge4qcelAosEwj3w/IPh9r26NPgceHx4X+J8lfqALxsKXlqyS/UgKpAxOijA1e9+iohZBUGfkBP+GOEvxfXrFm55vnXliyZCAOOGjOKCMoobBW4pGQ7KzD5E/y01wqktV3bxY08LiFwR51uiYvut19PeqQtA7hZSvAKn76AAmWv6I2yQU5WA338VH8vKn+vvbbktaUUoM+fCJAzMASo/MlWEBB4iZYALzzyP4M9IPFLu3Xott0DPvXUSijwpZUrXl7xEvh7CVevGIGrZNd8VOCNHoFetgA/4+/555cuWQLqRg1XAoVBVGDtAPnn3LEDf1nPgPYXvyRptU/JH/6L+DtERx2Aly2YgjmErHwJLeDKlxLwA3yYQV7dKGuBcf747M0Xob8X17y4cs3KlTAgCjAz3NpAfwYOrMFcDv4uIHxk3CHaawE3228nTdKmARz91AoEPSDhkxr80kuvKISv2l4xZsB4pACvMQMuWaIjCKP8jQlU4O0yAvsVuE0SyEemqzDCX3n55rR6TlzbBrDyZ4uffx5N4IqXVuAKFfillwQ+zat8cjBOuo+qZB06whdhwJUvQn9rnmcF9gVIA44ifxRgCQzI5yKV61Ph1DL2J780af1IIwTS1MJfui0DtmkAYw8uXvGLFRhCVr4MA4oEKUBToFmQCuS++giu2P6tW7mOe/KvfA38PbiE+A0fPRwGFAc2qMD+DHyJCWxd5JHhEYJA4Q8EptVxEdo4gE899fwKjCEowwEDBvtA6QHRBbIcYy558UXtAGlACHApSjChA4KjrQcU/mQEkdcE4a7Ql6MCB/yHuy2zIR+Zvx2kNJpmy4BtG8BFi3/xPOmjAYnfS6/g7CGIKURmkS3cMUYM+CLOq8AfHLhyJWo3O0C0gKOGmQFHaQsoAG63/bDadgfo9YAcggXA8s3r7XeTLmnTAC5e/PwvgB8nETjQSrA3hWgJ/tVWvniSb0Dix/JLA4I/XQQc/gAIVAPKCEIBepuBAaDxd1kIpPxa2A4Kgf4qYEmarcK08RK8+Bcr2QRyHdASr8BEUMvvli24XbUO+gOCUoIhwOe5FUTwGz5smN8D+hVYRxARYBJ6QK3DzSFRDEgAjcD02h8fadMA/mLxL36xEkWYG4RXcCVQCPTGEGkC5c4WDiBiQPK3kgCulCUYWYMZBgGOGS3rMA/KZmCOIDSgLcLwj3zp+fNoa5n/9JHFS3A0WmS/m3RJmwbwUSjwF1AgF2JeegnX7AJ9/jSKIF246sVVOoGwAsOAOgKPGQUDDn9ACjAMaFtBSvnXjO+HIAa8sDQLLP0kXDcbQzOgCrB0e2m03H436ZI2DeBrAPD5FTIGC30EMM4fBCj8kb24AaUAC39agYcho0aP0v2xHvQqcBlmEOkArQBfegO2LvLIUIC9Ehydd9J+N+mSNg3gmtFiQDoQ/lMGhcAEB0pAoI4g6ziDkEBUYBI46gEacPSo0aSRLSD50yMC7pAdAcnfRTAg0gytxeXXLAfaIzMDbi9Nuy3BbRzAZU8t+sXzRiDpkxoccGBiUIN1CvYEyA4Q8A0b9gCHYBjwwQdRgdeCwO3eKnTAgJc1zS3BfGTcErdrl7zqYrQk3VrAtg1gEQ2IGkz+GN+AHoKowRI2goECrAKk/0aPAX+cQsyAALAQAuRBebkrqjaA/CPbH/xSRqDjVXPpMwNiBMEQQv7KNqfdENy2Adyw+CmUYDMgq7AaUJYCiaDHH9SHC0eQlTICmwAfxPDLFpDLMKNHPSBD8OrV7AADizAk8OIYEFydD63Ax5vx2Yg8MtkUTABRgQ/ZryZt0qYBjD3AHlDnYMZqMOCrTyARZPm1jSDkb8liCJCLgMKfLEQTQD0gQj3+9Hx5QuyagR4jD4sLlXX6MknR9GsB2ziAS2QK8RFkCTYFJlRi4if1N2jABx9EARb/YQYZNhoC9Jeh7enAJFD5uwgGbAFXzQ0fFkMBigE3R9NsXyykbQP41FOLlwh+vgWNQJGghx9j/EkLqBV48ZLRYx7gCMyMGoUmEAJcqgdEYAmuZ8ALSQvAM071fL6vNAPy9dLJHwzoALy8WTp6UdCAAQVyg8iqVz0IFT/jjwA+v2QxZuDRHIGJ3wMPUIDSArIEb8YQnMCf/cEvLMbWOXLujzYWeXyeAaMlDsDLnGUjrQn0lmLIoADI+uuL0CvAPn+LUYEXPzh69APCHzKcM4j/fEytwB5/F25A5Dxs6Yf/Ezf2ic1hUR4ZV4p0GRAEbrDfSxqlbQM4/cmfCYBxAl9a8YrXBcJ8yt+qV+oR+JwswngdILfEwYAoweCPJbiMr43pd4DstOwvfmkTZ6459GkEQfhPtgSXOAAve4bJ1mAS+OSKFctfWu43gRrjb9ULL77gF2BtARc/uHjM6FEGICrxA9IC6p4IPCbWrh1+Bb4oBjxfEplrHoHyyPgwFcDtaXZoSk0bB3D0U4uVwCdX/AL0sQZzp1TDT/jDrchvBQgUBFfAgIsf/NGYeAEeJkOwtoC6BhOfgS/KCGw5L1f4hObbj8ED9GdgGNABeLkzyptCfiH8LV8eH0M0NOALVGBgBHlOFgFHx0swQgAhQG8EkQMiaKTM2d+7dWkmU/ZpctOsL5EHh4cJAYJACDD9VgHbPIBrR/7MavByELh8BYtwQhMIAl8Agi+++MJKOpD7DcKAi2HA0bYVhHngAV2F0WVobofj04EvugGbSsus54WPCvwFWsC02xCMtHEAo6MNwCeVQLSBr6wINoFiQPLHKhw34IOLuQho+MnuCDSgjCAl+myQBANe8gTt1+zIo5PXqJEKHC1yBrz8GTaSTeCTQuBy6A8SDNRgWQ18UQzIAwnq80fQAS5ePOZHgRYwUYBchZF9US+bARtJM1A0A3rHxYpGf1ptv5R0SlsHcPTIn3HH/CefJIEwoBRhA1D0t+oFKcBE8MWVL6x4nhV4yeIli3UR8F4lUIdgbQEhwO0UoOyLT/4u1IDN1Jp+Gq6brUE8PFRgm4G5DG2/k7RKWwfw0ZEjQZ8a8EkhcIXSJ4EBuQQo+L0A/GDA59ABgkDMIEEDBmYQEsgW0BZhWqq/OD7/abfNS7Ox88L/F4EKHC0pSsMZuO0DWDhs5CIz4JPEj2uBy+NNIA0oa4DUnxRgILhk8eIf2QwyaKgROHqMtwrIZwSLAbXHunADnp8t+4SWMoiHpxVYVwGLjtrvJK3S1gFEDV6sBkTYBYK+l15QAuG/F15gBcY1FLhCDQgBYgZWAAcqf1aC9ekgnEEuwIBMQ6Bwt3l4NR9CPjStwBRgSTRaZr+R9EqbB3DJyJ8tJoJQIPgjgWwChcAXKED474UXV8F9GEMwgADA5zCDWAto/KEE04BSgctK2AJKD0j8GjHguRmRjzYfo1aHD40I6ghSghn4bfuNpFfaPIBrRo588slFJJAG5EIM6LM+kPJ7hf6D/NSAwt8SqcAEcNBQD0HZHZ9PB7FVGMqlMQM2Gy39RF4380ta8KkSPjj8N/EXAaMOwKQkOpJNIFtA34DLVxiBECAmYRlCCB+XYFbQf+SPFXgohmASSAN6QzB7QFkFZA/Iv3OcwJbgwTT/81v6ncV+shXEKnBZem4GQdo8gGgCR6oBMQULgC+teGW5bQ0RAiFAy3NeBSaAMODAoWZAtoC2IbisxLaDiP8aGDBuKg8a3Mb50Xvxty0N3tF4mvjqRkL8EBqQAizbnKYzcCoAuHSkjCE+gS/J1hBUXTaBQFAK8Qqj0PizCjx0aHAKtl1htpdv554ISmCCARukHio+P4n79cXveXcbSdMfaTz8nwH8TIDcDJdWr5MeT9sHcDVqsN8DMiuWw4B0ILGTAEejTycQE+C99wJB1uAHhqkByV/ZdvIHuVAx8ne2P3k8Hiz1b+sH728+V4S22ZH/GUQQHSAMWIYOcLX9OtItbR/A2M+8GuwhCAPCgbDgK3K8BF9/SECAQwcpgmJAfwiWZUAxoPBHAyYmkZMmqKn/bnlb39nEV7Q0fHhiQBlBUIHT6zUy40kBANEEevzVIxAImv+EQH8NBgB+nwV4gEzBQ6UC04AlxX4LaPxRNU3EJ6khUp/8Z8J7g59wMfjTx8Y5XbeClJWURCvfsd9GuiUFACxmDU4owkrg8ldgQIHPMyAJtApM7jCDBAwYH4LLuQ5oBDae5mGEz+JZNsnxK3hp2fa5psNHRwIhQB4SpmiS/TLSLikAoNTghCJs/L20/IUXlrMTBIS4yAy8+DlW4JHfZ/OnBsTJ1qHloAiyCqjbQc5tQAXKuw5E3tHgvUyL+rymwv8ZTJ2/GRgtYGGaLsKkBoCswcrfz598VgwIBAVCwrfc9IeYAalAVmAzIKcQf18YOy7beQzoA5YIG+4kvkPjvfkJ/FfvQy2PPSQ+OBAIAfKQWNFi+1WkX1IBwMKRI3/mF2FRoAgQJ5yB3/IXlit+asDFPxo5mgYcOHTAAJuCdR2a/BHABAOeS4HnicGWwN+Fl2D+z2DEgKzAJdtLitLtsJTxpAKAsZEjTIE/f/LnIkAJCCSEQp8SaMswP0QJhgCVP1mKgQFtFYYb4sSAwt556avHWCDyrviHL4r9GH1IhiAqMDrAkmhxmr02QyApAeASGUMWkb8nl0sRNv0JfzyRP+aZxc+AwJGjHyB/9w7gphBOIbYOzR7QlqE/2kX/yR9a/uKNJJGnIGt6a8E91d5FsB/5E/YQbxUaHWBROj4ZxJISAG743gguBQqBpsBnQR8JfAE35I/n554RAy5aPHokKu/AoffeO+Dee3EPQ4i/DMimvtkGVNqMtfg9/xYJUHdxBmB5SIqg8FdSWhLdkKab4ZiUADA2UhW4cNHPn7Qx5CUToPhvOfF7hj3gM4ueW7T4h9IDkr57tQeMbwjhMmCzp+B4AsQF0wiQFxrfgPCfVODyEszA9mtIx6QGgMtGjPjZooXoARd5Bow7EFEEVzxDBYI/GhAhgegCkYQNIfKMJH8l+pxpBCz/XcE7dN/5IWyeIfmQZAKRRcDtpWXRNF6DQVIDwNgTVODCRQt/jthKjBmQXSC3Dz/zzDMgcBEr8A8hzGFsAWFAziFsAZd4L1CDHpBbQtgCqgGbhpBMCVf+HUk91IQrvO/iDCFmQNkMLB1gtCRakm5Hxg8mRQCc+MSIJ0Dgkws5BhuBz74iEiSA8myRFc+sWPzcokWLF/1o5Gj4zwzIcdgzYDH+mDBgOfhjCRb4zkWgJICVd1dv/Q/gDijkHHwRIgRiAAGB7FfJXxoekiieFAEwOkS6wIVUoPGHQZgA+gZc8Yw0gOAPBkQPOGAADcguEAaU48LQgFGvB1T+zl+G60WpuyibPBoLH488MhuBOYIUpt9BAQNJEQBjY9AFLoQBCeCzRFAu2gIyIBBjyDOLFy360SLhjzMwqrD2gJhB/L0BZQpmj9V8+AS3C0avGYJUI0sLKIvQJVwDTOcOMHUALBzxPdbghCbQawG5DMMBBAp8Bpr84Q9NgACQBuSmYH+HfJ2CFT/9Y9vf/jwJcnep9IeoAVF/dREa/JUUzrZfQXomVQCMLXpixM+e+DnHEBjwWZGfL0A+TwRTyHMswYt+uGj0SE7BECBS34Dsq/xDY4kBz0FgwHwI7lwy9PQby38KxtsPgRU4jRehmZQBcNIIjCE/W/hzLcLeICIjCAxI/ZFAlODFjRpwqS3D6EskGXzUjfzlzxGiEeTOv39JYBQD+jsClnI/mLTuAFMIwNj93xv5xEIbQwxA2SAngQMBICowDKgzCAx4Dw0IAr/PEowZBACWYQhhBxg34PkRbBBF76LMvInhY+Hj8nYEZAVOcwGmEIBLn0AX+MSTngKtAGsHuHz5c6JAGnARAAR/xO/eIVwHHPr90TCgbgrWVRgbgs2AzSIQ0Om5lWkmroYfDLjDOsA03gonSR0AY6OfGPHEQsTrAkGgrMGwA3xOe0CZQTAFg0AMwfdQgazBBFAMGNWXSPKPi9Ac/Opx59+XO60nsrGYAf0OEASm61NB/KQQgEuHfO+JnwmAgSL8yisrQCB3RPB6wEUjf0gDfsfHjwvRtjtgyWZuivNLsBiQf/XW52IWYsVPDIgCLAYsTvcKnEoAxoZhDjEHBuaQF1CD1YBciEYLqD0ghuB77rnn3nsI4PfVgPF9Eex56c0yoB+zXYL0LroBuQCDCswOEBNwSdoLMKUAnIQu8IlF0gRKGSaCwI8ASg9I/qBA6QGH3CsGvEeGEJTgict0b6xSz4AgEPAphOcLMPNIq09cIwZsDMpmiZL/Hag/5W/79pKSNF+EZlIJwNhAEmgK/DmaQNkeonvkswWUCvwjI5D0wYBSg7kMEzeg7JDq7w/YfAM2mouoQP53sDUYVmAU4LTeD8uSUgAWfgdFmAB6RdiqMHdGXY4B5JlF3Bb3QzaBQ4aIAQcMIYBxA9rT0kmgZ8BLlRaiyYej/Z8JkEswab4GyKQUgLFhT3zPJ5A12A8IxFlmEDGgrETDgPewAqMGe3vkR6kW/0WSxIAXFUGlrnVaVAK5BMMJpBQEzrV/djontQCMcQwhgYEuUINJmF0gEPwRt4QMGUr60AI2MKAtw3gEXgIDCn4tZVAfDB+XPhUODWBJWr4sQ/2kGIAT/yVYhMGfEviMrAZyh1RG1gHFgAPukY3BZkAQWKoE2hRC/C4Cgp8k4tbylRl5ILwmghQgOoVoyYZ0PR5RQlIMwNjIhKUYc+AzXIN5bsUzK9gDchlmJFtAcaAo0HZIhVTkeek7uEe+8IcoAq2L77oLWw0M0Ke7YckEHC1M3+diBpJqAC4bgi7wiRtJ4EKZQ0R/csZpBRWoJfjee+65mwjSgEN9A5aUor/yt4ToX14gaFV87gBhS2tuPNL78RahAAkgHmnhPPsnp3dSDcDY4ie+wbWYG4U/IfBZordoOdBbvOiZ57gzzMgRQ8WAd8OA3wF/I/1j5NOAAuBFMKBS13rwNHgEcfoQ8ldeWlKyYXoIRmAk5QCMDR3RUQcRVmGpwM8uX7R8+SJuCdGMHPH9IUPQAcYNKAuBMoWgCZQnJV20HjDwXKRWsigGRPCArAMsA3+F/9v+vWme1ANw47+MkOVoOPDZJ82AlKDCp1tC/lV7QBA49DtoAr/vHxnBN6AnwAvEz6OO1/HnqMtbevc8kUcgj0Pw0yWYchbgtN8IbEk9AGPDvtdxxBPfRBsoc4gYEAKEARVB2RtmCAn8GiFkCR76wJiJE22XfBQ4rkTjry1//AsxYH3GZBpuHngW+dnC30cfsy3QCoxHWVQYgo0gkhQEMDbkex07ogtkESZ7oA8nDz+0gCNGjvANeO8QjsHfHz3GdgikAbUEy1/9AvBT1OpdtTT2IESAUoDBHwpwSbrvBx1PKgK47IZvdOz4TdRgDiJC4JM0oBK4aAQJ/J4QKArkQswDo82AtjG4jkWYf/PWG7DeoYhadWQi+dnED3f4gHQNmruhpvHhsOolFQGMPfC9b3R84pveYiAJfIZFmPmh8AcDigKVvyGeAUHgdpRgNoGmQEFQaWhNWq8+iz0INgS2G+r2ks0lhYXT7F+a/klJAGMjocAnbpQibAQaf8gPwN+IgAHvYQ32NwbLDoHaBPIP33oD1g8wbDGJ+vPJH8/KHyeQoqft3xmCpCaALMLf1MXAhc8sxBDMLOTBYxYCwBEjMAXHDYgx5PuYQuwQvdwZIdGArVegL8DWSdDHj+OHvTK6LEEXpvXBOBKTmgDGlvwLCGQRpgLBHfhjDwj+Fv7gBzCgTiFqwHvZBAqAYkCdQuRvrgW4dfw1ylwLQRT8GDwU8CcFGA1gaCZgJkUBjA2lA7kUA+aWPwv3LRIQwd9C4Of3gEBQxuD4tjgzIAi0ItxaAjU+crjTYvw8A1KCyl9pSUlx0bS0fGXqJpKqAMaGgEBuE15OBp9dBPoWPcMSvHAEavC/Bg14z3eGcAy2vRH4Og0kUKdgj7/WMBhkr3Xhjyd/LMC6DbgMBTj9n4gUTMoCuLYPBhFZDAR+oG/hs7zLqAFvIHok8DuyLYTb4uTlgrmlQQG0IkwIDIjWhSswrWHQDMh2lP8d2AFSgKHZBqJJWQBjS1mECRy094xc039oATmF3HBDogFlHYZDyHZZCNzBEiwGFAJbJUCkHnYto1Dx8/jzdoKJFk4LzRKgJHUBjA2LE8hZWPDzWsARQ/7lnuvvuaeD8Icx2A7OETCgP4aIAVtKYKurrh/9sUqgvwQN/tL6eLyNJIUBjI00Atn/mQB/oAR2HHLDd66/5/oOX1MCUYPVgCRQDKg1WCIqajGBF46gGpCdgLcbfikn4PR/JnBiUhlAGYW1C3z22ScVwRFiwBE3DLl+CAxoVZjrMHKEQBqQzwxGDdYoga3gL55Wkqj6Q/gwyF95CSeQJWGagJmUBjB2wze+0ZEA/hzsPUsLKoH/CgPecP09X/tahw59CCDHYH8dBvxxY5w2gUqg0HAhELY48uM8/GQFprxkM5egwzWBIKkN4LTvGYELuW8qb60H7EgDXn/93V/rIB7kGOy9UMNmrcHylxcIDL6m+bvwhi8xPvPSALIAkz90gCHkL8UBjC3jFhEhEFmOYVgI7NgRU/D119+DHvBrnEWGYAwe8+AkVSA3xtGAQFDHkGQZUGL+214K/xWHahOIJcUBjK3xRmHmWUpQesB/veGGf4YBO1zfR8aQIUO4DrO6kAqMGoFiQIsasHECxX8XUYKCHhEkfQKgbQKGANP9YICNJNUBjD2KIuwTuHA5rwDg/xhywz/Dfdd36PA11mA0gbIxTuZgEqg1uJkGvMgl2OiTBtTjr5QDSBgFmPoAxsbAgegDfy4Aypr0DzqyBt8AA0KBHeI1mGMIpxCZg02BhqBCaIRcysgP45nhI5ABuFT8F7YVGEnqAwgCCSA3xf2ABOIWClQC+3ydS4EkEFPIoxO1BtsuWdwrGhJSFgQKY6RhLp4C+TM8AxI/bQBlAaZwkv17wpU0ADD21A0dv4EqTPKUwYViQGkCO3TQPWISarA3B8sQSvwEinMQePHCn8YfyQJs/Mmz4DCAhOR5mPWSDgDGxvxzxxuUQMrvmwtvRBHWGgwAxYBoAkcqgPhjy+ERpAZ7BJ7HgBe3C1QC5Wd7W+C4C0L4VmAkaQFgbMw3Ot6w8MafSxUe8YOON6IJ/B++Akkgm8DREycu0xrMnVLLvRqsaZYBL5xD+VHyA5U/PI7t0RD7L10AjI0f0vEbC2+UKsydYRCtweTva9wcJwsxtjEkqrtFy+Y4n8Bm8HfhkR8hP40/O7gAE8YBWJImAMaW3QAHLqQDAV9HlGAY0KvB119v+yOIAUHgdtRgf4cEq8FaGQWTSxaVH68AfgJ/Y+2fEb6kC4CxQhDYUZaiocCOIwRArwYrgQ+MmThJD1NpNRgEggMywVwuA+JHUbzGX6lsgVsWmuehN0jaABiLDuk4RAhkAe74rwYg+etwPbtA7pTqNYElpTxMYNCA5O+SC1ANqPqzLXB4LGgAQ7gFxEv6ABiLDcXs4VfhYA3mHgkYQ/znZpaU8JkhosB4F0g9XVIC9fv7/HEBmguA4C+kA7AknQCMLf7eiI4LFz77c1bhRAXKHDxyNGuwzsE8RpEtBXq5tAYU9mhALb9af5W/0A4gTFoBGFvSseMNI2SzHNrAQBNoBNpaNBXoG1B0pBQKIpcoincif7oAGG7+0gzA2OohKL8/4OYQbQOvv/7rX/0qAPz6Pdd/ZwiPj+ApkE2gERiI0XLxowUeoXLZ/ulTkBx/6QYgX8ihI2ZgIVAU+PUOHUigbA8OKFAOly9jiMTwu1QEkj/5EUH/6R4IoTgU/jmSdgDGRnOnfO6e8AMUYTGgKPD667UG+12gHqvXnp5pHryUBCJa8HX7hy0ATgvvAowm/QCMrVl4IxGkBGUO/upXv+IpULeGqAJBgTcIe3X4EvEn3xkR/AL9H/ibFOIFGE0aAhhbuvBGLkZ3fGLhEAD4VTgQBOpitAEoCtS1QD1Qm0/gxUdQviW/OV3r+Y/lF/yF7UnAjSQdAYxNHHGjrEZ3/CbnYNTga1GFOQgPfWDMo5P8QVi6QNknQeswosxc5Oi3Rug/Lv95/IW+/iJpCWBs2YiFN3IG6ShTCAmUIvwd2yCsB2rj8cr9vbKUQGXFuLk4se/K4ovsSOAvzAvQXtITwFh00cKFT4y44X+wBl8PAr8CAq+/3t8gXCgElvoEIkDEY+/iIShdJZnm98YPUf/xZ4O/x1z9RdIUwFhsJRx4Y0dR4Fc7SA3++j2eAu0p6vrsEJuEPQkiRs/FCb+h4I3soAA9/00qtkca7qQtgLHVy1GHR5BAzsHXQoFfVwWiC7SVGK8N1JcNMf60al5ovG9k869E5w/iR/5c/ZWkL4Cx2I/+54gbF3ZEEe4ABbIIc3OI7JJgc0gZDSgKVAKlCAt9UjtbHX4bXutd85+UX+Wv2PHnJ50BjG0cMuJGDCO+AjuwCEOBfPVqqcHcImcEAhFhRZ1FAluNoIEnV1LYFT8pv6y/5C9EhyE/d9IaQG4WQSNIB371WhJoSzETJ622pRg4UF+6i44S/BgyJFctjrCn9Cl+7C4RWX225Wdu/3X8eUlzAGPLho74Jgj8egco8DouxdwzdBgVaKvRaARZGBVBgUWxEYpaDCG/RL9M6ROmlT/+FB0/iguLl71tj84l7QGEBG8kgV9VBX7dFLiMc4i1gf4gottEEjTYbP78L9Evk/BZ74qftH+CH8aPZUvskbkg6Q9grHjhNzt2/OevdtAizGO1jeEGOSvC3CsBdJBA0RW5QYgUcZK754zypnflvr1HvlWcP3kNQvIXopfhak5CAGAstuRGEigOFAWiCMtqtBC4XdpAcSAYJDfmQAFJCGs8/BThz97gm/aeBvix/JJA+M/xl5BQABgrWXjjN25QAmUO0dXohDbQdozxFqUtQlmQQEImH1DW5KP+2/r5jIcf+ZPpV34Q/eeWnxMTDgBjsef/Z0cS+OUvg0BRoBZhaQOlCpsDCY3w44VkefeUMAVR3ss7Qp73EX03GVb6bPqQww/J8kvY9z9tkLAAGIv9UAi8FgTKYiDnkDiB4kDdQZUhPwTJIsgpcAKZd0/vIv4dxr5e8Isvvujyi1t+rp/wABh7cOEN139FCPQ2CReuLVYCZRDZoRL0SnAig4gAx7PSqNAloCehQI0/7f5IuOLn9NcwIQIwVjzyG9cDQCHwATleJRWok4iMwrocI/gIfQECTXc+bw3BY+Tr5KuJn+ivlM+9VP7CeQDA8yRMAMZiixd2uPYfuV+MLAbWI5AIaiMo9iOCJkNN48zFwy/iVyh+tvRc+jq/O6ePSSF/+lsTCReAsdiSoV/+xy97kzAJXG0ElsqL+RuBhEgQFJ4MsMZjjMqn8at2ae+n+rPFP+hv2Xi393OjCRuASCbaQDqQr961bDVXRoQSWQ/UDcMMYfLoaiz8gPc5vNG3lD+hD/jFF18Kl9kPd6mXEAIYm9Ctz5dBoDxFThyoe+hbFbZG0FpB4yqBRIHuY/mgvsEbCb+yPn7U30S3+txUwghgLJbxL9ehCssgolWYpJRCgRyGE+owQr7Imd7nlfCn1PkfQeSrCB/5M/ygv2mTHg3XK7C2KOEEMDatfYcOcQJRIpUWSlAtqBpEDC/1HN5QGPmmkigfQ4Q+yE97P/12or9Jk562H+rSSEIKYCyWQwfKICKzsDaClCDwAUWBDSOIwMZbRdDIk3dZlD4JGBb4BL9pkyY5/Z0roQUw9iiPWvl9EBichTkNC4IIJtkdu7zXdWWUQbkbjJCqYy/CY55G9VsVFj49aalb/Dt3wgtg7Gk5biqqsBDoTcNlakGBSbaN8GDmfj9o2fWRvEfQC8CH2MILgm84yQ2/502IAYzFBsh6IB0oZVglWEYJer2gDCQUoZDmI2erfQg1qZ/I+L2fVt/H3K4v502oAYwN464xsk1EJWhlWNYElUFOFeRPXGjQwX+aAHrl5aXc4y/qrzyj+rq1l2Yk3ADGJg2R7cITJ04yAj0EPQ3Sg+RMQNS2UGCUuhuovKUl20tKrfdT/JaF/sBXzUrIAUQZHsDnCj8KAoOdICPrgoqgj5pApzD6KeVzLf3WT/GbtMzteNW8hB7A2CQ5cKBIkJ2gvyZY8nqcQQSkWVcYDGdeBOoL2m+C2+++2XEAohPkMWOCEoxb0O8G/Rh5GrjPuj5JMfBbNmnixAn2jV3OHwcgMmmoHTerMQRLStEP6ok48sTgVj8cVfkVF4I+4Dd2dShfd7rVcQBKRt07BBIkgjKNrCZMAQYRFR2vfeVh6PXgY1YvWzapYIk75lrL4gC0PHgPCASCS2FBT4Nri4t1f1ImUGrtfgA+uA/4LV3m7NfSOAD9jFIEpRdcVggEBcLAykzDyCfgU5c9PWnpRLfLc2viAAxk1N3fGTrsgVHaDC4DgaCwuFi2kQQoxF2eTX0036SJjz3qjnffujgAEzJh2Mih3x+tO8lIJSaDa6nBYj6DTqDDld/0ceZFJkTy8+07uLQsDsB6iQ7vrwzyYNISxVB86F2j6C5bthTwPTpx/PgJEyKRvLyZ9vUuLYsDsGEKBw8d+f2RZJD7q1pWK4j6Bq336MRHxzw6fnxkcHZWr155D82zL3ZpWRyAjSa6bMzQkSMB4egxD5LDB0Ec52OCh0wc/+iY8eMHD87J6dHjjl69evfOe2i+faVLy+IAbDqFq8ePGjTsgWGDRo8ZPmb00kcfBIvjxw+LjBo2eFBOTsYtt3Tq3LlL9549AeBdM2bZF7m0LA7A8yZauHrSoxOWjp8w/N7+OX0zMm75Vqf2TKf2ALBzF+Ev7yEHYOviAGxBBLyrhD4JAezRsycAvGvGZPscl5bFAdiCdLqqfbu/v+rzHoJfaN+5c9ceMOBdMOAc+xyXlsUB2IJ0NvK8UIA9IEDMIDOm2ue4tCwOwBakkzZ/mi/QgF1hQFbgPFeCWxkHYAuCuSOYL0gLmA0B5uXNGGef49KyOABbkHoGBIFde/RABaYBHYCtiwOwBQkAKPh17nxbjx5iwBluHbCVcQC2IJ0TSjBawFukBYxgCH7I9YCtiwOwBTEDcvyQEwEUAT70kDNgK+MAbEGyOwO7fxQIBUOWYAAYycsbl+d2RmhdHIAtSOaXFLz2X/gCL52/1PW2zOxs8PfQuBkz7HNcWhYHYAvSqTMVSAaFwy/ccqvMIJG8cYg7Clur4gBsZuZF8iNdAaBnQOSWW267LTsb/D2UP2PqrOnzH3d75bc8DsDmZM+UXuMmTwaAX/gn4McLKQSAPVCB2QLOnDp1+rx586bNcbsFtjAOwPNmT0GkAMmbMznzlk7iv/Zf+gJOtwDAzMzs3mPz8sfNnDV17vS5QHDO7Hnu9RhaEgfg+fJYPvErKJg6uSC36y1f+BLq75fa4xoA3mYGzB83eda86XPnzi3as2fP3qLK/falLuePA/B8GTsF9E0pmDpl2uTcrp0hP0zA8B9yyy0ZHILH5oG/qfNgQCI4b8+8PXudBJsdB+A5Mp2ry2NB35SpU3AuGJxxy5foPg0NeGf2fZFIfv7kWbPmEb+5RUWQ4P59+w/oN3A5bxyATScf00UsFplimT4lktGV5CmBt9xya7cMVuCx+eOmGoBFLML79u3f79ZkmhsHYFMpQHM3blbBnEcgQEskEwb0whnkTgIIAU6dNY8Agr+ifeAPp1isaq99I5dzxQHYRCZgtpg8a87je33+phWMze5qBIK+W269NSMjO+e+sWMfmjpjDgZgEgj89u2rqtpfVbl33/49J+17uTQdB2Cj2WP8za8+PA8jiOaRSI4CSPzIX7fs7OzeY/PzWYH3z/2pVGDwtx/nSvC3d7+T4HnjAGws0yK989HZzdlbffjAHONv2iMTIvfdJuxJ0AGqAPOmTp06b958GnA9/bf/UNW+Q6Bw3569896xb+jSVByAjWRPby7uTX18b3X1gVkYgJlJUyaMH5ubYfSRv9u6YQbOxgyCFhAGXM8ZmPxV8lxVBQD37F3gCDxPHICNhPsX5E+eM//A3r1zpk4ngdMmTXlkfOS+3Ixbjb9vsQO8M3tgZCwBnDNv/v79AFAMWFVViWtoEAC6FcHzxQHYMBGMthEAuHf+vFlT50yH/aZNemTS+LGRiA9gt1u6dQN/OdkowflTp86as3f/gsP75hXto/toP3AIAIHgYfumLo3HAdggkVzwFxk3a86cOeAP/ntkyiOPTPrx+Efw3jtZg2E/GYEB4H0EsIDDcvU7ew9Uo/GrhPsqK/dxNZAE7t1bbd/WpdE4AOtnQm4kGz0gCuvkyai/06dMQh4ZP3ZsJPu++zJuu/XWbjIAd+t2JyrwfZHI2AKW4L3V8xcs2P+eEnhICVQFLrDv69JoHID10y8rO5sOLABYU+G/SY888siPUX+zs3tk52Z3u40I3nrrbRDgnTkDIcCxBajA/z7/j+8uQN47sL/yIAwIApU/KNBtljtXHID1Eumdm5UlTWC+bAKeBgMKf1k9bsvOybwt49bbuoE+dIB35qAC6xCMeeWP5G/BggMgEAY8KDMI8Nuz9x23We5ccQDWS6/MrMxMEjh2guwGM0n0R/569MjNyc7IuA2nbhmIAAgDTpkKAS5QAwqBqMH7Dh5CFRYBojW0b+3SSByAiZlwR1aP7pmZmSjC3AmQBXgU+csGfxnZ2dmQHwmE/+7MvvM+mUGmzpjz7+8cMP6QA/tQg6MHZSFQSrDbPfAccQAmJrNLVveM7j0yc3PHTpiA8wSMH5H7srN6ZvbokZmZnX0n6QN/VoG/SwDnzPn3BQt8AA8sQBUuXR+tqdxTRP72H3BjyDniAExMVpfuXZHMzMFjJ6AKP/LjUd+N5PbO6tmjZ2ZmDxgwM5MKBH/Z0gFiBs6fOgsVeMF/ET65WrBg3vrCX/6yVGowAdzrdkpoOg7AhEzP9ACMjI2MHY+g/oK/zB6ZPYEfDZh5250ZGdkowNoB5k+dOhsCpAL/67+MwH+fU7j6l7+Mri8S/g64JvAccQAmJNKpC/nrenvu4PGRyKixo76bm52FAaRnluCXk40qLPShAOfKDEwBagUW/Ejgv82eNeW1iYXRornz9qADdACeKw7AhES6iwC7Ztw/fnBk1HdHjcrN7pXVs2fPrKzekUhuLhhE8c3IlI1w5A8CnMkOEHn3XRPgvxHARx5c/cuiuWZAN4U0HQdgQrJuggFvvuXmrv3GD0a+e19mT+EvW7fPoQeEAGHA7Jzc3PtQpPPHTZ0hLSAUCAJRhEngjBmTx/544uqfAkDgd+CA2y2w6TgAE9Ljpu4339z1ZigwN2cQktOjR88ePag/hgZEDQZ+FCCfDZI/DvzNJnXvvvvHd4kgDThjxrj88T+eNn2u+A+x7+7SMA7AhKgBSWBOzsB7B+V07Y705IYRDCOR7KzMzGzUX4T1lwKcPGPGrNkgkAIkgh6AXMeeO08F6NZhzhEHYEK639QVBryFXWBOTv/+GZ27dOnSM4vb5cDffdlZJJD40YeRsXn5D82cMWvGAiqQ/P3x3T9CgQQwL2/sI9M4gkjc8TqajgMwId1vgvy6gsBbMvrffW8GXwmpew8U4LFjZXNIT7SEMg/37j2299i8vHHjZsyYMXv2bDSBAPDd/yJ/bAHH5Y0dO9UX4IEDbnNwk3EAJiRL+ENuz+hz9923dOrcqXMXdID5BSzBqMA9s7karS1hHgQoBM74939bsOAdEvgut4eIAPOnTJ83XwB8F0OIG4ObjAMwITd3J4EQ4Le6det23S2dkC49ABsrMATYM7NHFhekuc8+AFQDmgIPKIEowTNm5OcXTJ9HAVa/Vw0G3Y75TccBGMy023UZ8Pbbu3Xr89UvtW/fqVPnzndwBgF/PXv27NEzq0d2TzUg+MtTA2IKYReoBC6YPRMzsPF3+Mhh8Ld/vzNgk3EABhMx/m751rf6XPeV9gSwU6fuGEIivbOzevZgsrKyesOAvSN8eRo5Nq8Q+DjXAoHgO/Nnzxg3bir3kT5QfeTIKQoQBNr3d2kQB2AwWbIh5Pbbb8/odt11/wQAr2INvqNX795Z0F+PHpBgTxpQDkyOaAmeMRtVmG3gOwcOLJg9a9y4yVPhv/3VR06dOkL+AKCbQpqKAzCYHgAQ+N3e7VvXXfeVz/OlWa8mgRh9e+JD3WnAnj2zxH9qwHgXOPtxKHDBgsdnQX/G3+nTp0gfS7DbFtJUHIDBgLLbMQBnfAsC/OLn27W/6qpOILALV6MlslWYL4/ZO+8u4U8ECAPOFATnz589ayafpT5vz/7qU+QP9HFvBFeDm4wDMJiuXbuj/GIC6XbdtV+8on27dlddRQXe1EVyBxRIBFGR4UAS+JBXhGcQwccfnz0Lmc6dYKpPnjql/KELhAHd04ObiAMwkAJU4IwMGvC6L1/7+SsgQAWwS6cuXTrDg3fcwSaQ+PkGfGgGCZwJ/ChB4Q/+27O/CvMHSq/UXxLoDqDfRByAgUS6d88EgRkQ4Je/+PnPt2OuJoGdQWAXwa8XAv7uAoGCoBlwJgxI+mbN4oHa9uzZV3W4yvgDfrj7uP0Il3pxAAaCEnt7Jp/0gQr8D+DvqqvaXXUlALwJ6dL9DqGP/N0F+KQCPwQDqgBnzZ4p+IG/PUXzeJBUj7+qqgMHqt0Y3FQcgIH0u717JgowDXjt5//+CgrwSiiQCHbu0rML6bsL9PH1gbUCg0Dhb6bQN+tx8kcCeVgEQxD4VVGG++xnuCTGARhPUXc+5YghgJ+nAMWAV98EB3aBAKk+xvQn9Al+M8V/cxApwEX79vA4vftRe6towOrqqiq3R0zjcQDGE7m9hxLoG/BKnK+ULhAVWIuvuQ/hCDxznPA3Sw0oAO6ZV7RPjhTNgL8DoA8OdE+NazwOwHiyMnvEDfgPn7+CBlT+2AL24Ao0twHrCnTeDPA3btxkZuZkHkZm1lTfgDxOIPGDAYEfDIjrGvspLglxAMaT6ZXgbn2kBNOAOOkc3L07twIj3BFBN8Tl5eXn5wuBzFQeSosvVrNnbpFHIPkjfCCw2m0MaTQOQD8RFGABsG9fAAgDogMUA7IH7N61x234cGZWLndN0EzAqWCsvZJXQQEIJIB75u5Zr/yh8qIDFPx448aQxuIA9HM/CMvIBH7d+tgyjAgQCMKAXW/r2vU2Eork5uYONgbHy87SPIQHj6VvBtwzVwjE7KvuO3T48GEw6BTYWByAfjIzu+f0A38QoBnwKuWPTSDwgxt5AYHZOTm5gwbxeZuR8ePHR8ZPUASnTJviVWAAWEkDMoeqq5RA1wU2EgegF4DVL7NvjvDXp8O1X5QNIeBPDNiZu0nfdkvGrSzRPDJb/5ycnIFEcHBkVOS7Y8ePnzDhkSlTpv107twiI5D8sQOsrgZ+SJXrAhuLA9ALJpB+Of369u1PAK/7yhfZA15pCrypU9duGbd2y8AJybizb/87+/fPGThQLPjdUWNHKYHTps39KV+spvCn69fzSPkk8BCiBB6uqrUf5RKPA9DyE9TWnH79c/r379sfBvzKF/9BADQDdoUBu3W9lfQRwTsz+iM5A3MUwVGRUSjFBHCaGrAQBuTx8qX4+nEKbCQOQEsuBcjnAvfv3+fuPh2+eu0//L1nwCtZgjO63Ub0JHf36XM3P3HgoEEmwfFjwR8A/OlPC9fPXf/TXxYpgFWHqzz9SdwhEhrEAaiZcxOmWwBIAu/uc3e3Dl/8h/ZeDwgFov+j/vzcmdGXBObw+B2Dv4uTGPARAIgGcF5h4S9RgkHgYRjQKvDJk7iqOmE/zsWLA1CTlZmVmQMCiRUI7POVr7IJVP6u5BCcwdemsdzdrc/dd6ML7H+vGvC732UJ9g24jwCuVwOaAImfEGg/zsWLA1DC/RByxYBA8O67UYP9JhCXTjeDv2918xzYhwj2ZREWA4oCAeD4RyapAYvmFqIJrASBsB8JrCV+CAB0W4TrxQEoiWRmZlGAOTkDRIEkUGswGby6U0ZXg0/Tp1v/u1mD78UgTP4oQPBHAAuL1u8pggGj0gQKgR5+JNA9OaReHIDM5Iwsbt/IzR0oBlQAr/18u3Z/qyW4K58m4qdPH55lDOEcYgT+2AiEAderAfmaSRBgLauv4AcKD7kinBgHIHMHRmDgd//9IHAgubr77g7XXUsFCoBXd+cT5QLBnCz4QYHcIjJ81FgQaPwVrt8nBqyslCXAQ4qeORBF2G0STogDEJmQmZUlAswdlAMHsgpDgR2u/UcokA7EEGzkIdSfXAhgzgAYcNTgUeBvohJYSAMW/VIIFAMeOnmI8EmEQPcEuWAcgEiu7GCQez9POYMG5vQHgnf3ue46FmEasFNX7qQaSB8oEIUaBpR1mFE2g3gVeN/6QvaAh+hAVF1PgB6B7pjlgTgAhT8V4P25g3MG5eQMRBUegDbwOlEgAQzwJ/JDtAjnDEANhgHB36Txj0wTAtcXrV+/vsRq8GEgGOdPCKx2BAbiAIxN6O4VYGRw7qBBAwcOFAVyt1RR4E09fAD7yBVDAQ7oL9uDWYF/PH6STcFF+9av93vAWjKXkMMg0D1BxI8DsAj+4wSCwIAyiAzEKDJgAIvwP/49ALzaq8CkT+BD1IAD1IDj2QNOEAJlT5j1URjwoBgQPWC9oAhX7Z9nPz30cQDmZtoSjGQwzveDQDaCVoTbdeqa6RkQ44fH4N2yDqM9IEvw+EmyEA0Dro+iBsOAB9WAOCcGDtxfNcetCErCDuB0vwFEZArhGQgOQCPY57ov/9Pn213TKbNvBvfRQnz61IAD8GmDBg9nDzhRSrAYcN++aLQkqgZsiJ8W4f37q96zhxDuhBxA4hdvABHBjwpEEe5/T58O1/5j+5u/1a+v7QlIAyqB2gOCQC4E+gKcZAZEDY5WHqQBD6EDrMcgJ2FBcL5blA45gNO79wr4j2EXmHv/QBA4aGDOAA4iffshups04uEH/9GAA2UIGT58OACUFtB6wMoocpAE1ibgdwoniRC4d487dnSoAYxkMYaeyg9XA9WAlCBm4YF4M4f76asCjT9wKTMIPjxw0LDhw6HAR2UIUQNWQoDRUuGv3giMEEHuIFNdDQLdDoIhBjDSC+WX829EAWTAXy6nYE0OYQR/BNAUaFEDDpASnGjAuTBgpRDYwIBiP0jQEKyuPrB/f1HYd48JLYAFd/CZ5qSvHn+DBpkAKT95b04/e6pSQIC+AQcNGwwCaUBuCSkspAFBIAxYevBQTWIF5kEr9SZO4IKQSzCsAOYnll8JcGMPmGP4kb/Bg/EuMSCKbpw/RPjLkSFESvAETMHToEDhL8om0AxYL4BPIFQCgeDecK9KhxTAyB2qv34J+qMBcwblclMI8MO7OJHk5kCBSqCfvn1lBuk/IGcg8JMK/Ohjsg6dYMCDh2prAwQSPcAnRVgdyEYQnaA9qFAmnADK+JGb21vACzDICpw7iPulIhiEhUo1YLAJ7Ht3H3lKCLfEeT3ghEcnTPqpbQmJVpJAUWBiBebFg1AAlDI8L8xVOJQARnqRP+IXhA9DsPLHrcE5g3Luy+FEIrtJ908EEAiSPx2Chw+TLSHgT3pAPTKRGBAKTDAgclouAuGpk0eMwFC/lFcYAczqDf4i2blSf30EZeAQ/iA/OeXk5GIEpgC1BMcRhAJZgsWAOoOM54YQTsGFNGC08qAZ8HAQQA4fCp8SaA4EguHdPyaEAEZ6ZvUif0AvQYBAkPwNpgHJoCQuQOBnBPINNSDmlWFSgUdJDzjNDMjd8SvNgMYeovYTA2oNNgdKGQ4tgeEDMKtXr17ZudmGn4egTiC5g8kf2z+fQKQ/BYgkEEgEOQQPHA4CH4YBAeDTnEJ0CmYPSAUm1GDgx4UYXCQk0Mpw9YGw7icdOgAjvXpl5UayAwY0BrkVhI0fajBawIb8SQnmmXcH4IQWEAYcjjGY/D3KEixDcKIBff4+wEkMKAhSgLw6fERO1dX/ZY8vbAkbgHngr3d2b1Cn3HkGRAZz1WUgq7A2gJb+OgP7+AUMyBbQ6wEnTJBlQN+AVCAJtJVowIecPnn6NCowxxAvSuCRI2E9cEzIABT+hD699vmj/zCDDLqPXSDxMwT79+ufoS2gERjAT1asB7MEBwwo6zDgD+UX/NXE12E+OHkaZ9yePnUKZwlBRCPIOnzkSDgXY8IF4B4e6R7sBeiTG+kA1YDsAVmCNf0xgBh/fglWAvvyKB4DB94PAlmCH53AhWiOIQBQDMiVmHgNVgOiDIM9jiFeTp46ckoMePjwO6HcOytcAPbshe5P2fNOfu7PvS9n8GBOIb4A++fkZPTFWdOnG/HT9EcPyA6QFXjw8IdJIPFjDyg1mAqkBLkSDQKJH+BTA7IQG34SMAj+cA5lGxgqACO9epPA3gEGBcEI3GcG5BzsCZAHC7QlGD8iQLyvn0zBAJDPS7ce0NYBYUDihzEECNYEDEj1nT6N+nv61P81+CyYhpkwFuEwAZif3UteaZpDsDHoIUjyyOBgUEj7EUHAF8SPJVj5Y/oP6DcAn2UGtB6QO8Nwdyw1IIMekACqAUV+hDDRgAhfWx0J42JgmADs2QvsATuPPt5V+HJz7+OZDoQB7/MNmJEje0NLMjJQgn3++vaTA6QOvN8XoOyMMA0VWDbFVVYphOBPFEgET5NA0gf+6inwCDrBcCowRAByAInIC80IhnKyIQSR/aEH38cuMGegbv/IkUOWWzLQ/3ndIJcBWZ+1Ag+WFvCxxx7jCDKNh2eTIeSQtIBqQNXfBx+cYg32/JfIIPk7EsJNcuEBsCBLCrCVX7OgwhfRFpD+uw+X++8TAUoP6AuwD1+/xhtC+uGECuzNIDCgbAmZxm1xZkAQWHnwUNCAVoMb8R8SWgWGB8A7+ELTgp+Ap6e4ARHhDwQqfkgcPxhQzhrZCtJPpmCUYDHg+McwhIA/OUAl+avikWF8AwqCp8WARlwDBoXA8G2RCw2A01iAacBAKEKAhwvO0gXqLCwGlArsI5iBHtDuIv37yQwiBhz+sPSA4ycJgdIDahNI/A7V2oERRH+nTn5w+jTOXgw9Cw0YPgWGBkB0gMSPV54A1X1yRf2RPvjvvlzrAXO0BzQEM9ACWgHu23cgJ2QdQSjAuAH5pKSioj2swDw8KgkMGhDQCYIehIYegxpMBJ0B0zR5UoATBWgGFBZta4hQ6B0smhOw4McXR4obkFZU/oTAh9kDTrBtwYXcEoImkFPwIRJYe9jfGPzBB6f/YuD5MfokYsDQLcWEBcAIBCgGJHRmQKm/ZkDzoFIoewH2y+lrazBCHg3oMThA+OOTNn0D2irMNL5SEl+xP25A7+BE0N5fEGIXrMIBBqULdACmZziC5JoBPQb17NPH7SAiQSvAfDImxl1ARwP69OGd/TwD3j94eGRURKbgx6hAIbBoD18wHQqUY5Qf9sbgD4ifERiM0cfQgIdD9kThkADIDtDw02tGwbMbieCnAiR/8mw4q73xItyv/wB+PGBArkNDgeSvcC4NGGgCaw/rMfJFfxIDz4vBJwIUBO0hhyQhAbCnvta53wV6+uPd+lH+QKC0gL4BbRWGTPYLVODhESvBE6YIgdPRA4LAffv5Kg2KIPk76QlQYuxpjD+PwJDtFxgOANEB+ga0eOUXwU0Chh5+PCoReDPx+QT27yeb6ozAiOyNBQNOeow7pE4rmj4X/L3NF6wGf1KEaUBpAP8bJy9GH2L4IfRf2ObgcACYyxnYEJRlGI9AuZMYfSJSPxlCcMrIjBsQBIoA+3r8kUAqUAz4WAEFOA380YCVVR6BeoQiMNc4fw26wHA1geEA8H/pIgwrsGLIzo9XkkT9iQEzczL1sGy4JBqQYhzI19U0/iLaA4LAAinBcxEAiEGYUwj5EwOeZgkGgX9l6iFo8KEAC4HhWosOBYAF3A8hoQdEPAMaeBrFL5f+kxqcCfURQTVg30wakNMJ+MvFEMwm8GEYkPzpEDz9aZZgLsTsk9dMFwTZA6IEgz+JIBhYE1T8bARxAKZh2AISP9IXd6BnQN+EDOpvbr9+6j/gR+FlZBBD8IdiTCg5gpgBwV9E9ofmFPwTAoghBAqEAbkWKPzxFYO9HtDyl7/8Fae4BI1AhACG6+DR4QEwYEA1n3ebmH44if/69csggpkZIJDhOMymEAgKgKzA90eGiwEJ4IQJU8gfCZQxGDWYXaC0gaZAn0DyBwL/mgggFHgaAIZrKToUAPZWAK0HFAYZc59ea1CCQaAms18m+VMB4uIbUFrAHB5KVQ0I/HCWCowecLoZkF2gFGE+9VyXYf77v/8fEiDQHGgAWhF2Bky79NQZREqvH0+DyqCG8OVmsggLf/3AXSYoFPzYAAp/asD7dQjBDGIGLJhQQP9NnzsdPaCMIfu1CLMNtCZQABQC0Qj+RQaSOIFH6D9cux4w7XJTggH9eO7zBSivVwMI2QEqf6SP+FGFYkAiKP7L4eH0ZQa2AvyYCBBDSNH0ufPqKxAA+gZUBeoo8pfTQuCpU3/FCMwLFRiqbSFhAHDyTcKeGND4E/3ZbXAdhh0gCFP+iB8uyl/ffjSg+A8EDpQWUGdgTsHgjwYEgIjskSX8SRMIA5LA+gakBGlAnk+fOvJXsCcaPPJeqJrAMAAYsVUYLcNxBj0DehH6eMrKNP5IHyEUA8YJhAAREBiJDBb8SOAEEeB0ziBz9ogC96MIC39woAD4V+HPr8EiQRiQZ6B3mhPIX3FxAKZZDEA1oOFnsUZQ+GP65WYBPcTjzyewL4diiRRgW4ZGBQaB5A8CLJAxePr/BoNagfdXag2WxWhMIcAuQKAaEKEBT58ig8QvZBvjwgGgCdCvwJp6BmTxVQP26ycYGoFIBnlU/BDfgPAfKvD4h8WABVwHZAWeXqQtoCGIVPP1kk5JDQ4UYWsEyR8cyOqr/LkSnG7p7RswcQ62BDmkAftlZcUrMPUnsfKLeBPI/ffrzoAR5e8xz4AYg6crf6jBqkAh8PRf2PgJgUH+GPjvtHSBRHBvqDYGhwHALOPPg9ALuPOPEx3Jyu0XyQJ/GEBy4/XXCxpAT4HKn3SAbADFgEwBFDilvgExhoBA8OdNIUyAwCCC9szMI+85ANMsub28bcENIlMwTtm5ud8mh1kwIPwHDSp4XrQxZDgD4xPvz41wEYYVODIhQv4m/KRg2vRp0/43DDh3jy5FcwwRA1ZVe2OIkufHJIgpBP5jFwj+9roSnGbxhpCGCIK/7Ii+WAMCCcqJVdjAs0hFNgLxCQEDeh2g9IAgEJk7d57H3x4bQ0SB1gQGIoOwIShDCM5/fG+2M2CaBQCSwEgkzz/5AYK0YHYkFxIEezIF04GGHkP4PPxYf8WAwI/8PQz/CYA/KSgomDZFWkAQqACqAcWBNGAjCoy3gX9F/ydDyLuP28MOR8IDYKT3XSDNY89uQSUqcDbgy0YXSP6EQU7BiRJMMCArMBcBZXd81t+xXIX5yU+mTJtKB84rmuchaHNIdTVq8KnTp8FfkED2gHECaUAI8IADMN2S38kMGMmD/ZCAAuV4lWJAqcE45WRlYgxOwA/YGX74JF2CiXAGVgFKCwj+YEDhj1VY6NuLGgwFigG9MUQnYS9eAdZwDjny3oGZ9rDDkTAAGAOAIDCvt+AH3HAJItiPXWA2hmDp/7Iy+TLqMGDCHKIE5hJBbxEwoQXkhrgprMDED03gPFXgfhbh/fvFgGgCocAggTSgjyAnkFN//OO7B2bbow5HQgHgTVqDyV9BXr4a0Aik/iKRrEgvKpAG5FVWNg0Y1yDQQ1kWArUBFAMOfpjL0LjSCsxlQDHg3OlzrALv3esbUPZI4BhC4gL8BQ2IPhACXOAATLtc3QUARmBAJD8/yB/C1ywkffQg4csV+DiF4Mx5GPcNPx2SJRAgwq1wUoC5CojTtKmiwKJ5JkAYUHJAm8CTUKAQiIu6T8+aI0f+yBZw/gx71OFIOEpwlzvgQFBXwFNB/th8wKMIogfszfXo3sAvm/yRNjEgpCcY6qpgVr9vC38eftwQrPqLTHhYDThlynS/B0QJBoJ7TYF0oBgQCuRugLSf6K+BASHAx2fZow5HwmHATj2hQPFfXgFKMB3oKxDzB1+3Ibd3NgnMJoEIt8eRQIT31X+6UKgESnQGAX1iwCmeAUFfggKr2AUePnxEu0CJ4hfMqb9CgO++O3+WM2Da5RZRIKSHApyfDwXmB0qw8BfJ7t0v0is7N4tneC+bCJI/YVHwC9TfwBAM+00AhOgAC6b8xKZgXQkUAvfuFQPur67yxxCvCCOJAuQQfOCd2TNdD5h26dTpJgAoCpQhxBuFkd69WYRzswEh9Ycz2BPnyZnsCYHf7vdt+k8RtNFFCJwQoQFlCCmY7BlQKvA8DiF79+pi9H5ujTsCAE8rbWSvngGPcAR+Z9bkOfaow5FQAHhlOyqwdyQC+ApgwIICZVB3jiF8UoTFgBiBffxUgf3QGgYNGJFVaK7BsAN8GDNwhN/Sn4IRjMFag9EFigG5EGMKlDlEk0AgBPjegXfmz5pVaY86HAkFgJntrr7pjp6iQDOgX4G5iyD4y+6dnQUP9oIAaUBvGLECLG/L/jLyGtf0nzSB3AwSKRg71gT4ExhQFDhPukAdQpTAKgzCNCBr8Gl7OlJiuBHk3QMLZs/KswcdkoQCwF7trtQuUAmMl2HyB/xwyUYb2CubHALB+DisGIJAUqgdIOqvtwotM3AkH0Ow4FcwRSvwHCNQESSAB8Afa/BhEtgof7oGCAHOdACmYT7brtNNXbgSQ/DycSJ8CP3HI+f3ioA8xY8XNZ/cAX4Koy1TK4EqwMh4mYInTMgXAjED6/6AiPI3nwL0FXi4GvxJF+iNwsFgAj5wYP7jM8aFqwUMCYDt2l3dqYuuRguA6AF1CAF/LL+9AZ+U4V6gTRRI+sCgrMr0wztzacBIP1myFvxkEZAVODI2b4L0lch0LcFz4gb0u0Bdi+ZSIOeQhgQeOYICPH/WjJAJMCQAXvnZK6FAbxKWCH7kjyWY+IG/XkAQd8gg7ScTCQUo+vP8J5vvtAWUCiyLgFTg5J/QgCBwDgw4hwDOny8GNAIP8EWBpQZ7o3A8p/4I/iDAmTPCtQoYFgBv+iwUqARKFfZXogVB4CcIYgTpBdo4iXgEyh3Yj6MxELQRRAsw/QcIC3jSTEXEgHMgQRmD5/sAHrB9soTAhkVY+GMHGLIKHBIAY5+lAq0NJHpyBe4MPZ7gP76YvxRioc8MCAVmC3dZrL/AjheSNz4SGTt2bD7GYMVv8vQC0jeVBpyjBuRSoE+gbAyhAsWACRJk/QV/qMARe8ChSUgAbKcKJIG9AB8rcB7lZwGEkGNWb6CHE+pwwIBoA+UN2UyiCHoGRBeY9/BYCDBPEaQBqUAa0GrwPI9ADMKCII8C06AIYwBGAwj+Zky2BxyahATA7u3aXdmJBP4vVmEG/GH2Vfp69ab8ekUCBuyl7IkBs7Mj2dxjGu6LG1CXYCY8nAcF6gwy2fCbKgYUAOfN2+sXYeHviBx/QwwYR/CU8TdnZvgEGBYAY5/9WyoQbSD6wF53Re4S9BAqsVfvXlm8kyUXXEsfKAVYKOQZGHJ/BTUgwhEYyYsUPCxbl8GfGZBTCA1IAufPU/5A4IH9VbZTlhjwFDd94Io5ckTq75xZMx4K2wwcHgCv/my7dp3EgYqcR5/cZuEu3afnLA7DvbJ74V1KYe9sWajO4qssqT4lY8WB+XkT8saKAidPnSzLMEKgAAj+9swXBN+hAQHgEekCQd5ppQ9X7P/egf8enzVzRrj2xJKEBcBYu7+VIgwCBUGUXbkOhu7DGdiJCcFeVoRgAkSUYVZgGNCvwAi6STDIXWzI308KJrMKz5o+B2ffgPP9IiwEWhE+9dcjYkCcZAMI/TdrRl64ng4iCQ+AUCAIFAeiEQyELOpJr4CfZ0Ay2E+WCGG+LFziAhxrBsQAgik4HxVY8IMCcZ5lCvQJfGfvO9wcV/2eESjs6TPRuf5s/IVuAkFCA2Dsbz/b7kpz4B1ah+tF+0DBUAzIdhDFmfzl9s7tpQYMJh8OzEMN5uZlJVARnKP8zeEQHCdwLwxIBEkgJUgFcvsv27/5c1iA8/bYQw1TwgNgp3ZQ4NVXiwMxiiRaUIPuz9ATI3IoFgaze4FAjsyy6djL2AiXoNECyhAyzudv1tQ5U5XAOXMIFwMC31EAq5U/XHCr0+/8OfAf+AthBxgmAKUItxMC2QjecUdPwy4hMKBC6BlQekCZVGDABPogPxAYwQgCBOE/EjgZ+AFBdeDjc9SA4G8BHUgCD7ynfSDz7gHp/h4HfuRvgj3OcCVEAGZ95u9YhK0M97oDpyaTzR4QLPKMyD6rSLAJzAOE+ZG8AjSB3NHf+COCiOgPUf6YuAPfew+t4HvVfMP0F9YBhAkRgLFOVKA5kCuCjAHXSCDCbAqREwhAlOpLBI0+XuhAblkmgPnjCKAU4VlkkPg9Dgda9i6Yz0EkGNpP9Uf/5c23RxmyhAnA2GdJ4JVXXt1J1qRlUbqJSgz+pBFkQRb3aWhAY1A2KOfLCIIhJB8toChw8uRZyh/OjxPBx4U/ZG8CgfMpv/mP8/OUv3A9FSmeUAEY+QwJvIoSvMnrBM9ZibUMiwJFfzz7/BXQgRLwh7MpUGswDAgCHw9KcD6g27vgHVRio+9x+cRZsybPxPewhxi6hApAFGGuBrazRtBDsKlKTP3x7DmQ8CmB1J/S9zB38ocCx6EEK4FqQISTCAn0HAjqMIzYG1p68bn4inF5eQ/ZAwxfwgVg7Eo68ErrBJVB4a/JZjChAiNCIA8zIxgSQYYtoE/gZKvBs+fMnk3+AmXYAi0qfpMnz5zJ+hta/4UOwFg76QOtETw/gvQfbzz6eOFRtgQ+z4L5eXnjwB9qMAkEUkqXlGHW4UQCH398tnyQ7ps8c/I4+C/fHlwYEzYAY1dLH8hcrRaMQ0gOGyRRgdoFSh8I+OIGBIJiQM+BltmkTQicHT/JR2aCPRTfcdRfgT20UCZ0AMbaGYFXt2uHVlA2D5NAbp+jB5toBwPJ6x25izVY2dOoAWUOmUn8rA1kMGrMnp1In0Aqnw79hbn+IuEDEFX4M0KgRAqxP5FAhKzFCSszHEXiGoT9ehmBVogZNaCGavOLMKPQxePDJ+U35PyFEUA60CvDmEeuVAYNQSqQp3oJFGIeaRoXtoKBjFMJel2gxoiz8D2e+mTZRvAL4x4wwYQRQDrQI5BpzzpsDHoUJpbioAN739UbDvQU6GdcnqdAJAChhtMG0PPgk4VD+bKw8xdOAGOdPvOZz/6d4Ydm8OprgghqKa7PIGIAogsEgXIKhg6UTJ4xedwMvecLT8KlGsKn6DGRcB0Rv7GEE8BYBAQGOkGU4vbaDJoGdSiRguxHl6T12SS9lMG7UImDMdIaJgE7L98O31OQGiakALIRBIOGX7t211xzZXtvIAkw2NCDdwmDoPAuejDvLhTiu4wni3R29KE4UQYUSSSfZ73lV/XuNd0eSqgTWgBj7T4HBD9zhRGo8TRoq4PSD7Ii96q/C7WY0JrBb9dHsH6457R3ttved/Vy+pOEF8BYLgn8bLt4JW7f7mpoEO1gggkJoMbgQ+7yEZR+EGMxSnEChoBMcNN4d/FOnEHfXZHQTx+WEAOIWeTTlODnrrgi7sGreLkKHHoxF5JDuTIEJRyN5cz+kFKTdcJ4AgjG0xv4dnf68xJqALUThAWvaPe5OIPtcbn6qnbXtDcEkXhFljSYj8nit4XHejHmcOvd5Sc7/cUTcgC5ICNpRw0GG0KqsP1VAQgZo7D7Hd1lPOmJ8JkjDaLPKWF6ZSuXehgQ+WBkqv1sFyTsAFKCUogBIJMAIdK+XXvGAEQ64wwhdu7uBzR279kD6ZnVsyeuELlKiFRpibNfQhyAsOCnRILSDHrxQbxGrq5JpJDpzFOXzl26du+Oc2J69MCZSAqJdKRoEtIM+ZbfhnEAMu0+JRZErrgijqEASAShQbSEkk7AsB6JYsWunTt37ooEYOzRPatHpiLI3HFH914OvwZxAGrafeZvzIOf+ZxXjpnEkty+vXEoiZPY1W4pRQHRGER6dL8D7N1xx02dev7EfpZLIA5AL13bfepvlMC/C0LI6UQwvAaFWK5FhwEQwaGSeDMBBIvmQg/A7t27dO/U1S28NB4HYCCoxJ82CK8IQAgG5Wwa9AMUfQLl7GGIdOkkDHbtctNNN3e6+eZQ7/R8zjgAE9LjM5/6FCgkguAvWIvVhR6FKkKuGHpjMnvDuAq7dr25u93t1Olh++YujcQBWD9drwCDf+MNJZ/5XOJsbDEQr0FVRkFu197G5LgHNVd3ut2V3nPHAdhIcq/5zKc+bSKszyDS7oprcPJLMuCDBdt1agf+rqEHr2nXSd7Xqbtz33njAGwina749Kf+Bia0elyPQXUgEdR1QinFcpfBnU5uc2/z4gA8R7q2+/SnUY8FQ+HQ4PPSTkzoc/d3OjG3v+ZmZ75mxwF4vtz8GdRjAVE4tLr8OUjxc3pzBe4xBLJ9Pye+lsUB2Lzkoq274tN/AxQ5JceDUflzmJbb39wpy6HXmjgAW5HMzK6dumd2z73fMXfBcQC6JDUOQJekxgHoktQ4AF2SGgegS1LjAHRJahyALkmNA9AlqXEAuiQ1DkCXpMYB6JLUOABdkhoHoEtS4wB0SWocgC5JjQPQJalxALokNQ5Al6TGAeiS1DgAXZIaB6BLUuMAdElqHIAuSY0D0CWpcQC6JDUOQJekxgHoktQ4AF2SGgegS1LjAHRJahyALkmNA9AlqXEAuiQ1DkCXpMYB6JLUOABdkhoHoEtS4wB0SWocgC5JjQPQJalxALokNQ5Al6TGAeiS1DgAXZIaB6BLUuMAdElqHIAuSY0D0CWpcQC6JDUOQJekxgHoktQ4AF2SGgegS1LjAHRJahyALkmNA9AlqXEAuiQ1DkCXpMYB6JLUOABdkphY7P8HO/7CUabZRIYAAAAASUVORK5CYII=',
};

module.exports = device;
