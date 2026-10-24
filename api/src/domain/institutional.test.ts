import { describe, expect, it } from 'vite-plus/test';
import {
  INSTITUTIONAL_DOMAINS,
  classifyInstitutionalEmail,
  describeIdentity,
  isInstitutionalEmail,
} from './institutional';

describe('the institutional allow list', () => {
  it('covers both institute domains', () => {
    expect(INSTITUTIONAL_DOMAINS).toEqual(['morelia.tecnm.mx', 'itmorelia.edu.mx']);
  });
});

describe('isInstitutionalEmail', () => {
  it('accepts a mailbox of the TecNM campus domain', () => {
    expect(isInstitutionalEmail('ana.ruiz@morelia.tecnm.mx')).toBe(true);
  });

  it('accepts a mailbox of the itmorelia domain', () => {
    expect(isInstitutionalEmail('ana.ruiz@itmorelia.edu.mx')).toBe(true);
  });

  it('ignores the case', () => {
    expect(isInstitutionalEmail('Ana.Ruiz@MORELIA.TECNM.MX')).toBe(true);
  });

  it('rejects a subdomain of an allowed domain', () => {
    expect(isInstitutionalEmail('ana.ruiz@correo.morelia.tecnm.mx')).toBe(false);
    expect(isInstitutionalEmail('ana.ruiz@mail.itmorelia.edu.mx')).toBe(false);
  });

  it('rejects a look alike domain', () => {
    expect(isInstitutionalEmail('ana.ruiz@morelia.tecnm.mx.evil.com')).toBe(false);
    expect(isInstitutionalEmail('ana.ruiz@notmorelia.tecnm.mx')).toBe(false);
    expect(isInstitutionalEmail('ana.ruiz@tecnm.mx')).toBe(false);
  });

  it('rejects a mailbox outside the campus', () => {
    expect(isInstitutionalEmail('ana.ruiz@gmail.com')).toBe(false);
  });

  it('rejects a malformed address', () => {
    expect(isInstitutionalEmail('')).toBe(false);
    expect(isInstitutionalEmail('morelia.tecnm.mx')).toBe(false);
    expect(isInstitutionalEmail('@morelia.tecnm.mx')).toBe(false);
    expect(isInstitutionalEmail('a@b@morelia.tecnm.mx')).toBe(false);
  });
});

describe('classifyInstitutionalEmail', () => {
  it('recognizes a student control number', () => {
    expect(classifyInstitutionalEmail('L1234567@morelia.tecnm.mx')).toBe('student');
  });

  it('recognizes a student control number in another case', () => {
    expect(classifyInstitutionalEmail('l1234567@morelia.tecnm.mx')).toBe('student');
  });

  it('recognizes a role mailbox', () => {
    expect(classifyInstitutionalEmail('sistemas@morelia.tecnm.mx')).toBe('role');
    expect(classifyInstitutionalEmail('soporte@itmorelia.edu.mx')).toBe('role');
    expect(classifyInstitutionalEmail('admin@morelia.tecnm.mx')).toBe('role');
    expect(classifyInstitutionalEmail('caja@morelia.tecnm.mx')).toBe('role');
    expect(classifyInstitutionalEmail('financieros@morelia.tecnm.mx')).toBe('role');
  });

  it('treats the rest of the campus as staff', () => {
    expect(classifyInstitutionalEmail('juan.perez@morelia.tecnm.mx')).toBe('staff');
  });

  it('rejects a mailbox outside the campus', () => {
    expect(classifyInstitutionalEmail('ana.ruiz@gmail.com')).toBe('rejected');
  });

  it('rejects a subdomain of an allowed domain', () => {
    expect(classifyInstitutionalEmail('L1234567@correo.morelia.tecnm.mx')).toBe('rejected');
  });
});

describe('describeIdentity', () => {
  it('describes a student', () => {
    expect(describeIdentity('L1234567@morelia.tecnm.mx')).toEqual({
      email: 'l1234567@morelia.tecnm.mx',
      domain: 'morelia.tecnm.mx',
      kind: 'student',
      controlNumber: '1234567',
    });
  });

  it('describes a role mailbox without a control number', () => {
    expect(describeIdentity('Sistemas@morelia.tecnm.mx')).toEqual({
      email: 'sistemas@morelia.tecnm.mx',
      domain: 'morelia.tecnm.mx',
      kind: 'role',
      controlNumber: null,
    });
  });

  it('describes a rejected mailbox', () => {
    expect(describeIdentity('ana.ruiz@gmail.com')).toEqual({
      email: 'ana.ruiz@gmail.com',
      domain: 'gmail.com',
      kind: 'rejected',
      controlNumber: null,
    });
  });
});
