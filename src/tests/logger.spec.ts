import { info, success, warn, error, group, endGroup } from '../libs/logger';

describe('logger', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('info calls console.info with message', () => {
    const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
    info('informing');
    expect(spy).toHaveBeenCalledWith('informing');
  });

  test('success calls console.info with message', () => {
    const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
    success('it worked');
    expect(spy).toHaveBeenCalledWith('it worked');
  });

  test('warn calls console.warn with message', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    warn('be careful');
    expect(spy).toHaveBeenCalledWith('be careful');
  });

  test('error calls console.error with message', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    error('oh no');
    expect(spy).toHaveBeenCalledWith('oh no');
  });

  test('group emits azure group marker', () => {
    const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
    group('MyGroup');
    expect(spy).toHaveBeenCalledWith('##[group]MyGroup');
  });

  test('endGroup emits azure endgroup marker with and without title', () => {
    const spy = jest.spyOn(console, 'info').mockImplementation(() => {});
    endGroup();
    expect(spy).toHaveBeenCalledWith('##[endgroup]');

    spy.mockClear();
    endGroup();
    expect(spy).toHaveBeenCalledWith('##[endgroup]');
  });
});
