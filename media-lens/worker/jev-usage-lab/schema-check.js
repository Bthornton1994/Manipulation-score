// Minimal JSON Schema checker for the decision-contract fixture records.
// Supports the subset this repo's contract uses. It is not a general validator.

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value) && typeof value === 'number') return 'integer';
  return typeof value;
}

function matchesType(value, declared) {
  const actual = typeOf(value);
  const allowed = Array.isArray(declared) ? declared : [declared];
  if (allowed.includes(actual)) return true;
  if (actual === 'integer' && allowed.includes('number')) return true;
  return false;
}

export function validateContractSchema(schema, value, path = '$') {
  const errors = [];
  walk(schema, value, path, errors);
  return errors;
}

function walk(schema, value, path, errors) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path} type ${typeOf(value)} not in ${JSON.stringify(schema.type)}`);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema.const) {
    errors.push(`${path} const mismatch`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} not in enum`);
  }
  if (typeof schema.pattern === 'string' && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path} pattern mismatch`);
  }
  if (typeof schema.minLength === 'number' && typeof value === 'string' && value.length < schema.minLength) {
    errors.push(`${path} minLength`);
  }
  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
    errors.push(`${path} below minimum`);
  }
  if (typeof schema.maximum === 'number' && typeof value === 'number' && value > schema.maximum) {
    errors.push(`${path} above maximum`);
  }
  if (schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array') && Array.isArray(value))) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${path} minItems`);
    if (schema.items && Array.isArray(value)) {
      value.forEach((item, index) => walk(schema.items, item, `${path}[${index}]`, errors));
    }
  }
  const objectLike =
    schema.type === 'object' ||
    (Array.isArray(schema.type) && schema.type.includes('object') && isObject(value)) ||
    (schema.properties && isObject(value));
  if (!objectLike || !isObject(value)) return;
  const required = schema.required || [];
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} required`);
  }
  const properties = schema.properties || {};
  for (const [key, child] of Object.entries(value)) {
    if (properties[key]) walk(properties[key], child, `${path}.${key}`, errors);
    else if (schema.additionalProperties === false) errors.push(`${path}.${key} additional`);
    else if (isObject(schema.additionalProperties)) walk(schema.additionalProperties, child, `${path}.${key}`, errors);
  }
}
