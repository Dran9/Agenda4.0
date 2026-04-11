const { google } = require('googleapis');
const { getOAuthClient } = require('./calendar');

function getPeopleService() {
  return google.people({ version: 'v1', auth: getOAuthClient() });
}

async function getOrCreateContactGroup(people, groupName) {
  const groups = await people.contactGroups.list({ pageSize: 50 });
  let group = groups.data.contactGroups?.find((item) => item.name === groupName);

  if (group) return group;

  const created = await people.contactGroups.create({
    requestBody: { contactGroup: { name: groupName } },
  });
  return created.data;
}

async function createContact({ firstName, lastName, phone, city, email }) {
  const people = getPeopleService();

  const contactData = {
    names: [{ givenName: firstName, familyName: lastName || '' }],
    phoneNumbers: [{ value: phone, type: 'mobile' }],
  };

  if (city) {
    contactData.addresses = [{ city, type: 'home' }];
  }

  if (email) {
    contactData.emailAddresses = [{ value: email }];
  }

  // Add the contact to the tracked Google Contacts labels we use in Agenda 4.0.
  try {
    const groupNames = ['Pacientes', 'Agenda4.0'];
    const memberships = [];

    for (const groupName of groupNames) {
      const group = await getOrCreateContactGroup(people, groupName);
      if (!group?.resourceName) continue;

      memberships.push({
        contactGroupMembership: { contactGroupResourceName: group.resourceName },
      });
    }

    if (memberships.length > 0) {
      contactData.memberships = memberships;
    }
  } catch (groupErr) {
    console.error('[contacts] Group error (non-fatal):', groupErr.message);
  }

  const res = await people.people.createContact({ requestBody: contactData });
  console.log(`[contacts] Created: ${firstName} ${lastName || ''} (${phone})`);
  return res.data;
}

module.exports = { createContact };
