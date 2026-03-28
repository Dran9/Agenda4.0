const { google } = require('googleapis');
const { getOAuthClient } = require('./calendar');

function getPeopleService() {
  return google.people({ version: 'v1', auth: getOAuthClient() });
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

  // Add to "Pacientes" contact group if it exists, or create it
  try {
    const groupName = 'Pacientes';
    const groups = await people.contactGroups.list({ pageSize: 50 });
    let group = groups.data.contactGroups?.find(g => g.name === groupName);

    if (!group) {
      const created = await people.contactGroups.create({
        requestBody: { contactGroup: { name: groupName } },
      });
      group = created.data;
    }

    if (group?.resourceName) {
      contactData.memberships = [{
        contactGroupMembership: { contactGroupResourceName: group.resourceName },
      }];
    }
  } catch (groupErr) {
    console.error('[contacts] Group error (non-fatal):', groupErr.message);
  }

  const res = await people.people.createContact({ requestBody: contactData });
  console.log(`[contacts] Created: ${firstName} ${lastName || ''} (${phone})`);
  return res.data;
}

module.exports = { createContact };
