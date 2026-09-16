/**
 * Catalogue of UCM API actions the kit knows about.
 *
 * `tested` lists the firmware on which the action was exercised against real hardware.
 * Anything without a tested entry comes from Grandstream's API guide and is unverified.
 * `write: true` actions change the PBX or place calls and must be allow-listed on the client.
 */
export const TESTED_PLATFORM = { model: 'UCM6304', firmware: '1.0.33.30' };

const T = [`${TESTED_PLATFORM.model} ${TESTED_PLATFORM.firmware}`];

export const ACTIONS = {
  getSystemStatus: { group: 'system', tested: T },
  getSystemGeneralStatus: { group: 'system', tested: T },

  listAccount: { group: 'extensions', listKey: 'account', tested: T },
  getSIPAccount: { group: 'extensions', tested: T },
  addSIPAccount: { group: 'extensions', write: true },
  updateSIPAccount: { group: 'extensions', write: true },
  deleteSIPAccount: { group: 'extensions', write: true, dangerous: true },
  applyChanges: { group: 'system', write: true },

  listVoIPTrunk: { group: 'trunks', listKey: 'voip_trunk', tested: T },
  listAnalogTrunk: { group: 'trunks', listKey: 'analogtrunk', tested: T },
  listDigitalTrunk: { group: 'trunks', listKey: 'digital_trunks' },

  listInboundRoute: { group: 'routing', listKey: 'inbound_route', tested: T },
  listOutboundRoute: { group: 'routing', listKey: 'outbound_route', tested: T },

  listRingGroup: { group: 'groups', listKey: 'ringgroup' },
  listQueue: { group: 'groups', listKey: 'queue', tested: T },
  listIVR: { group: 'groups', listKey: 'ivr', tested: T },
  listPagingGroup: { group: 'groups', listKey: 'paginggroup', tested: T },
  listVoicemailGroup: { group: 'groups', listKey: 'vmgroup' },
  listConference: { group: 'groups', listKey: 'conference' },
  listDepartment: { group: 'contacts', listKey: 'local_department_info', tested: T },

  listBridgedChannels: { group: 'calls', listKey: 'channel', tested: T },
  listUnBridgedChannels: { group: 'calls', listKey: 'channel', tested: T },
  dialExtension: { group: 'calls', write: true },
  dialOutbound: { group: 'calls', write: true },
  Hangup: { group: 'calls', write: true },
  callTransfer: { group: 'calls', write: true },

  listIPC: { group: 'devices', listKey: 'ipc', tested: T },

  cdrapi: { group: 'cdr', note: 'answers without a status field on 1.0.33.30' },
  listZeroConfig: { group: 'devices', note: 'returned -47 on 1.0.33.30 until granted' },
};

export const READ_AUDIT_ACTIONS = Object.entries(ACTIONS)
  .filter(([name, a]) => !a.write && name !== 'getSIPAccount' && name !== 'cdrapi')
  .map(([name]) => name);

export function isWriteAction(action) {
  // Unknown actions are treated as writes so they must be allow-listed explicitly.
  return ACTIONS[action] ? Boolean(ACTIONS[action].write) : !/^(get|list)/.test(action);
}
