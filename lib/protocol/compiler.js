// constants
const POD_TYPES = ['bool', 'byte', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'float', 'double', 'vec3', 'vec3fa', 'angle', 'skillid32', 'skillid', 'customize'];
const TRIVIALLY_COPYABLE_TYPES = ['bool', 'byte', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'float', 'double', 'string', 'angle'];

const MULT_INT16_TO_RAD = 1 / 0x8000 * Math.PI,
      MULT_RAD_TO_INT16 = 1 / MULT_INT16_TO_RAD;

// def compilation
function _escapedName(prefix, fullName) { return `${prefix}_${fullName.replace(/[\.\[\]]/g, '_')}`; }
function _countName(fullName) { return _escapedName('count', fullName); }
function _offsetName(fullName) { return _escapedName('offset', fullName); }
function _elemName(fullName) { return _escapedName('elem', fullName); }

function _transpileReader(definition, path = '', offset_static = 0, offset_dynamic = false, imports = { vec3: false, skillid: false, customize: false }) {
    let result = '';
    
    function offset(len) {
        const res = offset_dynamic ? (offset_static > 0 ? `buffer_pos + ${offset_static}` : 'buffer_pos') : `${offset_static}`;
        if (len)
            offset_static += len;
        return res;
    }

    const serializers = {
        byte: (varName) => (varName ? `${varName} = ` : '') + `buffer.getUint8(${offset(1)}, true)`,
        bool: (varName) => (varName ? `${varName} = ` : '') + `!!buffer.getUint8(${offset(1)}, true)`, // TODO: check if 0/1
        uint16: (varName) => (varName ? `${varName} = ` : '') + `buffer.getUint16(${offset(2)}, true)`,
        uint32: (varName) => (varName ? `${varName} = ` : '') + `buffer.getUint32(${offset(4)}, true)`,
        uint64: (varName) => (varName ? `${varName} = ` : '') + `buffer.getBigUint64(${offset(8)}, true)`,
        int16: (varName) => (varName ? `${varName} = ` : '') + `buffer.getInt16(${offset(2)}, true)`,
        int32: (varName) => (varName ? `${varName} = ` : '') + `buffer.getInt32(${offset(4)}, true)`,
        int64: (varName) => (varName ? `${varName} = ` : '') + `buffer.getBigInt64(${offset(8)}, true)`,
        float: (varName) => (varName ? `${varName} = ` : '') + `buffer.getFloat32(${offset(4)}, true)`,
        double: (varName) => (varName ? `${varName} = ` : '') + `buffer.getFloat64(${offset(8)}, true)`,

        angle: (varName) => (varName ? `${varName} = ` : '') + `buffer.getInt16(${offset(2)}, true) * ${MULT_INT16_TO_RAD}`,
        vec3(varName) { imports.vec3 = true; return (varName ? `${varName} = ` : '') + `new Vec3(${serializers.float()}, ${serializers.float()}, ${serializers.float()})`; },
        vec3fa(varName) { imports.vec3 = true; return (varName ? `${varName} = ` : '') + `new Vec3(${serializers.float()} * ${MULT_INT16_TO_RAD}, ${serializers.float()} * ${MULT_INT16_TO_RAD}, ${serializers.float()} * ${MULT_INT16_TO_RAD})`; },
        skillid32(varName) { imports.skillid = true; return (varName ? `${varName} = ` : '') + `SkillID.fromUint32(buffer.getUint32(${offset(4)}, true))`; },
        skillid(varName) { imports.skillid = true; return (varName ? `${varName} = ` : '') + `SkillID.fromUint64(buffer.getBigUint64(${offset(8)}, true))`; },
        customize(varName) { imports.customize = true; return (varName ? `${varName} = ` : '') + `new Customize(buffer.getBigUint64(${offset(8)}, true))`; },
    };

    // Implementation
    for (const [name, type] of definition) {
        const fullName = (path !== '') ? `${path}.${name}` : name;

        if (!Array.isArray(type)) {
            switch (type) {
                case 'refArray': {
                    result += `let ${_countName(fullName)} = ${serializers.uint16()};\n`;
                    result += `let ${_offsetName(fullName)} = ${serializers.uint16()};\n`;
                    break;
                }

                case 'refBytes': {
                    result += `let ${_offsetName(fullName)} = ${serializers.uint16()};\n`;
                    result += `let ${_countName(fullName)} = ${serializers.uint16()};\n`;
                    break;
                }

                case 'refString': {
                    result += `let ${_offsetName(fullName)} = ${serializers.uint16()};\n`;
                    break;
                }

                case 'string': {
                    const curTmpName = _escapedName('c', fullName);

                    offset_dynamic = true;
                    offset_static = 0;

                    // TODO: check offset
                    result += `buffer_pos = ${_offsetName(fullName)};\n`;
                    result += `${fullName} = '';\n`;
                    result += `for(let ${curTmpName}; ${curTmpName} = buffer.getUint16(${offset()}, true); buffer_pos += 2)\n`;
                    result += `${fullName} += String.fromCharCode.apply(null, ${curTmpName});\n`;
                    break;
                }

                case 'bytes': {
                    const curIdxName = _escapedName('i', fullName);
                    const countName = _countName(fullName);

                    offset_dynamic = true;
                    offset_static = 0;

                    // TODO: check offset
                    result += `buffer_pos = ${_offsetName(fullName)};\n`;
                    result += `${fullName} = Buffer.allocUnsafe(${countName});\n`;
                    result += `let ${curIdxName} = 0;\n`;
                    result += `for(; ${curIdxName} < ${countName}; ++${curIdxName}) ${fullName}[${curIdxName}] = buffer.getUint8(buffer_pos + ${curIdxName}, true);\n`;
                    break;
                }

                default: {
                    if (!POD_TYPES.includes(type))
                        throw new Error(`Invalid data type "${type}" for field "${fullName}"!`);

                    result += `${serializers[type](fullName)};\n`;
                    break;
                }
            }
        } else {
            switch (type.type) {
                case 'object': {
                    const tmpElemName = `tmpelem_${_offsetName(fullName)}`;

                    result += `${tmpElemName} = {};\n`;
                    const sub_result = _transpileReader(type, tmpElemName, offset_static, offset_dynamic, imports);
                    result += sub_result.result;
                    offset_static = sub_result.offset_static;
                    offset_dynamic = sub_result.offset_dynamic;
                    result += `${fullName} = ${tmpElemName};\n`;
                    break;
                }

                case 'array': {
                    const offsetName = _offsetName(fullName);
                    const countName = _countName(fullName);
                    const tmpOffsetName = `tmpoffset_${offsetName}`;
                    const tmpIndexName = `tmpindex_${offsetName}`;
                    const tmpElemName = `tmpelem_${offsetName}`;
                    const curElemName = `${fullName}[${tmpIndexName}]`;

                    result += `${fullName} = new Array(${countName});\n`;
                    result += `let ${tmpOffsetName} = ${offsetName};\n`;
                    if (!type.subtype)
                        result += `let ${tmpElemName};\n`;
                    result += `for (let ${tmpIndexName} = -1; ++${tmpIndexName} < ${countName};) {\n`;

                    // TODO: check offset
                    offset_dynamic = true;
                    offset_static = 2;
                    result += `buffer_pos = ${tmpOffsetName};\n`;
                    result += `${tmpOffsetName} = ${serializers.uint16()};\n`;

                    if (type.subtype) {
                        if (type.subtype === 'string') {
                            const curTmpName = _escapedName('c', fullName);

                            offset_static = 0;
                            result += `buffer_pos += 6;\n`;

                            // TODO: check offset
                            result += `buffer_pos = ${offsetName};\n`;
                            result += `${curElemName} = '';\n`;
                            result += `for(let ${curTmpName}; ${curTmpName} = buffer.getUint16(${offset()}, true); buffer_pos += 2)\n`;
                            result += `${curElemName} += String.fromCharCode.apply(null, ${curTmpName});\n`;
                        } else {
                            if (!POD_TYPES.includes(type.subtype))
                                throw new Error(`Invalid data type "${type.subtype}" for array "${fullName}"!`);

                            result += `${serializers[type.subtype](curElemName)};\n`;
                        }
                    } else {
                        result += `${tmpElemName} = {};\n`;
                        const sub_result = _transpileReader(type, tmpElemName, offset_static, offset_dynamic, imports);
                        result += sub_result.result;
                        offset_static = sub_result.offset_static;
                        offset_dynamic = sub_result.offset_dynamic;
                        result += `${curElemName} = ${tmpElemName};\n`;
                    }

                    result += '}\n';
                    break;
                }

                default:
                    throw new Error(`Invalid aggregate type "${type}" for field "${fullName}"!`);
            }
        }
    }

    return { result, offset_static, offset_dynamic, imports };
}

function _transpileWriter(definition, path = '', empty = false, offset_static = 0, offset_dynamic = false) {
    let result = '';

    function staticToDynamic() {
        offset_dynamic = true;
        if (offset_static == 0)
            return '';

        let res = `buffer_pos += ${offset_static};\n`;
        offset_static = 0;
        return res;
    }

    function offset(len, delta = 0) {
        offset_static += delta;

        const res = offset_dynamic ? (offset_static > 0 ? `buffer_pos + ${offset_static}` : 'buffer_pos') : `${offset_static}`;
        if (len)
            offset_static += len;
        return res;
    }

    const overwriteUint16 = (where, varName) => `buffer.setUint16(${where}, ${varName}, true)`;

    const serializers = {
        byte: (varName) => `buffer.setUint8(${offset(1)}, ${varName ? `${varName}` : '0'}, true)`,
        bool: (varName) => `buffer.setUint8(${offset(1)}, ${varName ? `${varName} ? 1 : 0` : '0'}, true)`,
        uint16: (varName, checks = true) => checks ? `buffer.setUint16(${offset(2)}, ${varName ? `${varName}` : '0'}, true)` : `buffer.setUint16(${offset(2)}, ${varName}, true)`,
        uint32: (varName) => `buffer.setUint32(${offset(4)}, ${varName ? `${varName}` : '0'}, true)`,
        uint64: (varName) => `buffer.setBigUint64(${offset(8)}, ${varName ? `${varName} ? BigInt(${varName}) : 0n` : '0n'}, true)`,
        int16: (varName) => `buffer.setInt16(${offset(2)}, ${varName ? `${varName}` : '0'}, true)`,
        int32: (varName) => `buffer.setInt32(${offset(4)}, ${varName ? `${varName}` : '0'}, true)`,
        int64: (varName) => `buffer.setBigInt64(${offset(8)}, ${varName ? `${varName} ? BigInt(${varName}) : 0n` : '0n'}, true)`,
        float: (varName) => `buffer.setFloat32(${offset(4)}, ${varName ? `${varName}` : '0'}, true)`,
        double: (varName) => `buffer.setFloat64(${offset(8)}, ${varName ? `${varName}` : '0'}, true)`,

        angle: (varName) => `buffer.setInt16(${offset(2)}, ${varName ? `${varName} ? (${varName} * ${MULT_RAD_TO_INT16}) : 0` : '0'}, true)`,
        vec3: (varName) => `if (${varName}) { buffer.setFloat32(${offset(4)}, ${varName}.x, true); buffer.setFloat32(${offset(4)}, ${varName}.y, true); buffer.setFloat32(${offset(4)}, ${varName}.z, true); } else { buffer.setBigInt64(${offset(8, -12)}, 0n, true); buffer.setInt32(${offset(4)}, 0, true); }`,
        vec3fa: (varName) => `if (${varName}) { buffer.setFloat32(${offset(4)}, ${varName}.x * ${MULT_RAD_TO_INT16}, true); buffer.setFloat32(${offset(4)}, ${varName}.y * ${MULT_RAD_TO_INT16}, true); buffer.setFloat32(${offset(4)}, ${varName}.z * ${MULT_RAD_TO_INT16}, true); } else { buffer.setBigInt64(${offset(8, -12)}, 0n, true); buffer.setInt32(${offset(4)}, 0, true); }`,
        skillid32: (varName) => varName ? `switch (typeof ${varName}) { case 'object': { if (!${varName} instanceof SkillID) { ${varName} = new SkillID(${varName}); } buffer.setUint32(${offset(4)}, ${varName}.toUint32(), true); break; } case 'number': { buffer.setUint32(${offset(4, -4)}, ${varName}, true); break; } default: { buffer.setUint32(${offset(4, -4)}, 0, true); break; } }` : `buffer.setUint32(${offset(4, -4)}, 0, true)`,
        skillid: (varName) => varName ? `switch (typeof ${varName}) { case 'object': { if (!${varName} instanceof SkillID) { ${varName} = new SkillID(${varName}); } buffer.setBigUint64(${offset(8)}, ${varName}.toUint64(), true); break; } case 'bigint': { buffer.setBigUint64(${offset(8, -8)}, ${varName}, true); break; } default: { buffer.setBigUint64(${offset(8, -8)}, 0n, true); break; } }` : `buffer.setBigUint64(${offset(8, -8)}, 0n, true)`,
        customize: (varName) => varName ? `switch (typeof ${varName}) { case 'object': { if (!${varName} instanceof Customize) { ${varName} = new Customize(${varName}); } buffer.setBigUint64(${offset(8)}, ${varName}.toUint64(), true); break; } case 'bigint': { buffer.setBigUint64(${offset(8, -8)}, ${varName}, true); break; } default: { buffer.setBigUint64(${offset(8, -8)}, 0n, true); break; } }` : `buffer.setBigUint64(${offset(8, -8)}, 0n, true)`,
    };

    // Cache interleaved arrays
    let interleavedArrays = [];
    let interleavedArrayDefinitions = {};
    let interleavedArraysFirstIdx = null;
    for (let i = 0; i < definition.length; ++i) {
        const [name, type] = definition[i];
        if (Array.isArray(type) && type.type === 'array' && type.flags.includes('interleaved')) {
            if (interleavedArraysFirstIdx !== null && interleavedArraysFirstIdx + 1 !== i)
                throw new Error('Interleaved arrays must be consecutive fields!');

            interleavedArraysFirstIdx = i;
            interleavedArrays.push(name);
            interleavedArrayDefinitions[name] = type;
        }
    }

    for (const [name, type] of definition) {
        if (interleavedArrays.includes(name) && Array.isArray(type)) {
            // Check if already serialized
            if (empty || interleavedArrays[0] !== name)
                continue;

            // Initialize header
            const nameInfo = {};
            interleavedArrays.forEach(name_ => {
                const fullName = (path !== '') ? `${path}.${name_}` : name_;
                const offsetName = _offsetName(fullName);
                const tmpLastName = `tmplast_${offsetName}`;
                const elemName = _elemName(fullName);
                nameInfo[name_] = { fullName, offsetName, tmpLastName, elemName };

                result += `let ${tmpLastName} = ${offsetName};\n`;
            });

            result += staticToDynamic();

            const lengthName = _elemName((path !== '') ? `${path}._interleaved_maxlength` : '_interleaved_maxlength');
            const idxName = _elemName((path !== '') ? `${path}._interleaved_index` : '_interleaved_index');
            result += `let ${lengthName} = Math.max(${interleavedArrays.map(name_ => `${nameInfo[name_].fullName} ? ${nameInfo[name_].fullName}.length : 0`).join(',')});\n`;
            result += `for (let ${idxName} = 0; ${idxName} < ${lengthName}; ++${idxName}) {\n`;
            interleavedArrays.forEach(name_ => {
                result += `if (${nameInfo[name_].fullName} && ${idxName} < ${nameInfo[name_].fullName}.length) {\n`;
                result += `${overwriteUint16(nameInfo[name_].tmpLastName, 'buffer_pos')};\n`;
                result += `${serializers.uint16('buffer_pos', false)};\n`;
                result += `${nameInfo[name_].tmpLastName} = ${offset()};\n`;
                result += `${serializers.uint16()};\n`;

                const curElemName = nameInfo[name_].elemName;
                result += `let ${curElemName} = ${nameInfo[name_].fullName}[${idxName}];\n`
                if (interleavedArrayDefinitions[name_].subtype) {
                    if (interleavedArrayDefinitions[name_].subtype === 'string') {
                        result += `${serializers.uint16(`${offset()} + 2`, false)};\n`;
                        result += staticToDynamic();

                        if (empty) {
                            result += `${serializers.uint16()};\n`;
                            result += staticToDynamic();
                        } else {
                            result += `if (${curElemName} && ${curElemName}.length > 0) {\n`;
                            result += `for (let i = 0; i < ${curElemName}.length; ++i) {\n`;
                            result += `${serializers(`${curElemName}.charCodeAt(i)`, false)};\n`;
                            result += staticToDynamic();
                            result += '}\n';
                            result += '} else {\n';
                            result += `${serializers.uint16()};\n`;
                            result += staticToDynamic();
                            result += '}\n';
                        }
                    } else {
                        if (!POD_TYPES.includes(interleavedArrayDefinitions[name_].subtype))
                            throw new Error(`Invalid data type "${interleavedArrayDefinitions[name_].subtype}" for array "${nameInfo[name_].fullName}"!`);

                        result += `${serializers[interleavedArrayDefinitions[name_].subtype](curElemName)};\n`;
                    }

                    result += staticToDynamic();
                } else {
                    const sub_result = _transpileWriter(interleavedArrayDefinitions[name_], curElemName, false, offset_static, offset_dynamic);
                    result += sub_result.result;
                    offset_static = sub_result.offset_static;
                    offset_dynamic = sub_result.offset_dynamic;

                    result += staticToDynamic();
                }
                result += '}\n';
            });
            result += '}\n';
        } else {
            const fullName = (path !== '') ? `${path}.${name}` : name;

            if (!Array.isArray(type)) {
                switch (type) {
                    case 'refArray': {
                        result += `${serializers.uint16(`${fullName} ? ${fullName}.length : 0`, false)};\n`;
                        result += `let ${_offsetName(fullName)} = ${offset()};\n`;
                        result += `${serializers.uint16()};\n`;
                        break;
                    }

                    case 'refBytes': {
                        result += `let ${_offsetName(fullName)} = ${offset()};\n`;
                        result += `${serializers.uint16()};\n`;
                        result += `${serializers.uint16(`${fullName} ? ${fullName}.length : 0`, false)};\n`;
                        break;
                    }

                    case 'refString': {
                        result += `let ${_offsetName(fullName)} = ${offset()};\n`;
                        result += `${serializers.uint16()};\n`;
                        break;
                    }

                    case 'string': {
                        result += staticToDynamic();
                        result += `${overwriteUint16(_offsetName(fullName), offset())};\n`;
                        
                        if (empty) {
                            result += `${serializers.uint16()};\n`;
                            result += staticToDynamic();
                        } else {
                            result += `if (${fullName}) {\n`;
                            result += `for (let i = 0; i < ${fullName}.length; ++i) {\n`;
                            result += `${serializers.uint16(`${fullName}.charCodeAt(i)`, false)};\n`;
                            result += staticToDynamic();
                            result += '}\n';
                            result += '}\n';
                            result += `${serializers.uint16()};\n`;
                            result += staticToDynamic();
                        }
                        break;
                    }

                    case 'bytes': {
                        result += staticToDynamic();
                        result += `${overwriteUint16(_offsetName(fullName), offset())};\n`;

                        if (!empty) {
                            result += `if (${fullName}) {\n`;
                            result += `for (let i = 0; i < ${fullName}.length; ++i) {\n`;
                            result += `buffer.setUint8(buffer_pos + i, ${fullName}[i], true);\n`;
                            result += '}\n';
                            result += '}\n';
                            result += `buffer_pos += ${fullName}.length;\n`;
                        }
                        break;
                    }

                    default: {
                        if (!POD_TYPES.includes(type))
                            throw new Error(`Invalid data type "${type}" for field "${fullName}"!`);

                        result += `${serializers[type](empty ? undefined : fullName)};\n`;
                        break;
                    }
                }
            } else {
                switch (type.type) {
                    case 'object': {
                        if (!empty) {
                            result += `if (${fullName}) {\n`;

                            const sub_result = _transpileWriter(type, fullName, false, offset_static, offset_dynamic);
                            result += sub_result.result;
                            offset_static = sub_result.offset_static;
                            offset_dynamic = sub_result.offset_dynamic;

                            result += '} else {\n';
                        }

                        const sub_result = _transpileWriter(type, fullName, true, offset_static, offset_dynamic);
                        result += sub_result.result;
                        offset_static = sub_result.offset_static;
                        offset_dynamic = sub_result.offset_dynamic;

                        if (!empty)
                            result += '}\n';

                        break;
                    }

                    case 'array': {
                        if (empty)
                            break;

                        const offsetName = _offsetName(fullName);
                        const tmpLastName = `tmplast_${offsetName}`;
                        const curElemName = _elemName(fullName);

                        result += staticToDynamic();

                        result += `if (${fullName} && ${fullName}.length > 0) {\n`;
                        result += `let ${tmpLastName} = ${offsetName};\n`;

                        result += `for (let ${curElemName} of ${fullName}) {\n`;
                        result += `${overwriteUint16(tmpLastName, 'buffer_pos')};\n`;
                        result += `${serializers.uint16('buffer_pos', false)};\n`;
                        result += `${tmpLastName} = ${offset()};\n`;
                        result += `${serializers.uint16()};\n`;

                        if (type.subtype) {
                            if (type.subtype === 'string') {
                                result += `${serializers.uint16(`${offset()} + 2`, false)};\n`;
                                result += staticToDynamic();

                                if (empty) {
                                    result += `${serializers.uint16()};\n`;
                                    result += staticToDynamic();
                                } else {
                                    result += `if (${curElemName}) {\n`;
                                    result += `for (let i = 0; i < ${curElemName}.length; ++i) {\n`;
                                    result += `${serializers.uint16(`${curElemName}.charCodeAt(i)`, false)};\n`;
                                    result += staticToDynamic();
                                    result += '}\n';
                                    result += '}\n';
                                    result += `${serializers.uint16()};\n`;
                                    result += staticToDynamic();
                                }
                            } else {
                                if (!POD_TYPES.includes(type.subtype))
                                    throw new Error(`Invalid data type "${type.subtype}" for array "${fullName}"!`);

                                result += `${serializers[type.subtype](curElemName)};\n`;
                            }

                            result += staticToDynamic();
                        } else {
                            const sub_result = _transpileWriter(type, curElemName, false, offset_static, offset_dynamic);
                            result += sub_result.result;
                            offset_static = sub_result.offset_static;
                            offset_dynamic = sub_result.offset_dynamic;

                            result += staticToDynamic();
                        }

                        result += '}\n';

                        result += '}\n';
                        break;
                    }

                    default:
                        throw new Error(`Invalid aggregate type "${type}" for field "${fullName}"!`);
                }
            }
        }
    }

    return { result, offset_static, offset_dynamic };
}

function _transpileCloner(definition, fromPath = '', toPath = '') {
    let result = '';
    for (const [name, type] of definition) {
        const fullNameFrom = `${fromPath}.${name}`;
        const fullNameTo = `${toPath}.${name}`;

        if (!Array.isArray(type)) {
            switch (type) {
                case 'refArray':
                case 'refBytes':
                case 'refString':
                    break;

                case 'bytes':
                    result += `${fullNameTo} = Buffer.from(${fullNameFrom});\n`;
                    break;

                case 'vec3':
                case 'vec3fa':
                case 'skillid32':
                case 'skillid':
                case 'customize':
                    result += `${fullNameTo} = Object.assign(Object.create(Object.getPrototypeOf(${fullNameFrom})), ${fullNameFrom})\n`;
                    break;

                default: {
                    if (!TRIVIALLY_COPYABLE_TYPES.includes(type))
                        throw new Error(`Invalid data type "${type}" for field "${fullNameFrom}"!`);

                    result += `${fullNameTo} = ${fullNameFrom};\n`;
                    break;
                }
            }
        } else {
            switch (type.type) {
                case 'object': {
                    result += `${fullNameTo} = {};\n`;
                    result += _transpileCloner(type, fullNameFrom, fullNameTo);
                    break;
                }

                case 'array': {
                    if (type.subtype) {
                        if (TRIVIALLY_COPYABLE_TYPES.includes(type.subtype)) {
                            result += `${fullNameTo} = ${fullNameFrom}.slice();\n`;
                        } else {
                            const tmpIndexName = `tmpindex_${_offsetName(fullNameFrom)}`;
                            const curElemNameFrom = `${fullNameFrom}[${tmpIndexName}]`;
                            const curElemNameTo = `${fullNameTo}[${tmpIndexName}]`;

                            result += `${fullNameTo} = new Array(${fullNameFrom}.length);\n`;
                            result += `for (let ${tmpIndexName} = 0; ${tmpIndexName} < ${fullNameFrom}.length; ++${tmpIndexName}) {\n`;
                            result += `${curElemNameTo} = Object.assign(Object.create(Object.getPrototypeOf(${curElemNameFrom})), ${curElemNameFrom})\n`;
                            result += '}\n';
                        }
                    } else {
                        const tmpIndexName = `tmpindex_${_offsetName(fullNameFrom)}`;
                        const curElemNameFrom = `${fullNameFrom}[${tmpIndexName}]`;
                        const curElemNameTo = `${fullNameTo}[${tmpIndexName}]`;

                        result += `${fullNameTo} = new Array(${fullNameFrom}.length);\n`;
                        result += `for (let ${tmpIndexName} = 0; ${tmpIndexName} < ${fullNameFrom}.length; ++${tmpIndexName}) {\n`;
                        result += `${curElemNameTo} = {};\n`;
                        result += _transpileCloner(type, curElemNameFrom, curElemNameTo);
                        result += '}\n';
                    }
                    break;
                }

                default:
                    throw new Error(`Invalid aggregate type "${type}" for field "${fullName}"!`);
            }
        }
    }
    return result;
}

function transpile(definition) {
    const reader = _transpileReader(definition, 'result', 4, false);
    const writer = _transpileWriter(definition, 'data', false, 4, false);

    // Build imports
    let imports = [];
    if (reader.imports.vec3)
        imports.push('Vec3');
    if (reader.imports.skillid)
        imports.push('SkillID');
    if (reader.imports.customize)
        imports.push('Customize');

    if (imports.length > 0)
        imports = 'let {' + imports.join(',') + '} = require("tera-data-parser").types;\n';
    else
        imports = '';

    // Combine
    return {
        reader: imports + (reader.offset_dynamic ? 'let buffer_pos = 0;\n' : '') + 'let result = {}; \n' + reader.result + 'return result;\n',
        writer: imports + (writer.offset_dynamic ? 'let buffer_pos = 0;\n' : '') + writer.result + (writer.offset_dynamic ? (writer.offset_static > 0 ? `return ${writer.offset_static} + buffer_pos;\n` : 'return buffer_pos;\n') : `return ${writer.offset_static};\n`),
        cloner: 'let result = {};\n' + _transpileCloner(definition, 'data', 'result') + 'return result;\n',
        isDynamicLength: reader.offset_dynamic,
        minLength: reader.offset_static,
    };
}

function compile(definition) {
    const transpiled = transpile(definition);
    return {
        reader: Function('buffer', '"use strict";\n' + transpiled.reader),
        writer: Function('buffer', 'data', '"use strict";\n' + transpiled.writer),
        cloner: Function('data', '"use strict";\n' + transpiled.cloner),
        isDynamicLength: transpiled.isDynamicLength,
        minLength: transpiled.minLength,
    };
}

module.exports = { transpile, compile };