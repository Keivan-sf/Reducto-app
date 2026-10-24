import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  groupInviteToken,
  groupInviteUri,
  groupJoinPath,
  internalLinkPath,
  linkify,
  linkifyMentions,
} from '../src/lib/links';
import { redirectSystemPath } from '../src/app/+native-intent';

const token = '32d48175eefe9c95142073e7c2ac93aadf87e126616733142362774c8c8ab40a';
test('native app launches route root URIs to the normal app entry', () => {
  for (const path of ['reducto://', 'reducto:///', 'REDUCTO:///', 'reducto:///?source=launcher']) {
    assert.equal(internalLinkPath(path), '/');
    for (const initial of [true, false]) {
      assert.equal(redirectSystemPath({ path, initial }), '/');
    }
  }
  assert.equal(redirectSystemPath({ path: '/', initial: true }), '/');
});
test('group invites use a triple-slash app URI and support legacy pasted invites', () => {
  assert.equal(groupInviteUri(token), `reducto:///api/groups/join/${token}`);
  for (const input of [
    token,
    groupJoinPath(token),
    groupInviteUri(token),
    `REDUCTO://api/groups/join/${token}`,
    `http://localhost:3000/api/groups/join/${token}/`,
  ]) {
    assert.equal(groupInviteToken(input), token);
  }
});
test('custom links only route the exact supported group-join action', () => {
  assert.equal(internalLinkPath(groupInviteUri(token)), groupJoinPath(token));
  for (const input of [
    `reducto:///api/groups/${token}`,
    `reducto:///api/groups/join/${token}/extra`,
    `reducto://other/api/groups/join/${token}`,
    'reducto:///api/groups/join/invalid',
    `javascript:///api/groups/join/${token}`,
    `https://example.com/api/groups/join/${token}`,
  ]) {
    assert.equal(internalLinkPath(input), '/unsupported-link');
  }
  assert.equal(groupInviteToken(`ftp://host/api/groups/join/${token}`), null);
  assert.throws(() => groupInviteUri('bad-token'), /Invalid group invite/);
});
test('native deep links normalize the app URI and leave Expo Go URLs for the router', () => {
  assert.equal(
    redirectSystemPath({ path: groupInviteUri(token), initial: true }),
    groupJoinPath(token),
  );
  assert.equal(
    redirectSystemPath({ path: `reducto://api/groups/join/${token}`, initial: false }),
    groupJoinPath(token),
  );
  assert.equal(
    redirectSystemPath({ path: 'reducto:///unsupported', initial: true }),
    '/unsupported-link',
  );
  const expo = `exp://192.168.1.10:8081/--/api/groups/join/${token}`;
  assert.equal(redirectSystemPath({ path: expo, initial: true }), expo);
});
test('message URLs preserve surrounding text, punctuation and balanced parentheses', () => {
  const text = `See (https://example.org/a_(b)?x=1&y=2), www.example.com/path.\nJoin ${groupInviteUri(token)}!`;
  const parts = linkify(text);
  assert.equal(parts.map((part) => part.text).join(''), text);
  assert.deepEqual(
    parts.filter((part) => part.href).map((part) => ({ href: part.href, internal: part.internal })),
    [
      { href: 'https://example.org/a_(b)?x=1&y=2', internal: false },
      { href: 'https://www.example.com/path', internal: false },
      { href: groupInviteUri(token), internal: true },
    ],
  );
});
test('unsupported app links remain links while unsafe schemes and malformed URLs remain text', () => {
  assert.equal(linkify('reducto:///unknown')[0].internal, true);
  const text = 'javascript:alert(1) data:text/html,bad https:// ordinary text';
  assert.equal(
    linkify(text).some((part) => part.href),
    false,
  );
  assert.equal(
    linkify(text)
      .map((part) => part.text)
      .join(''),
    text,
  );
});

test('username mentions follow syntax and preserve punctuation, case, and all message text', () => {
  const text = `Hi (@Username_12), @a! @${'z'.repeat(32)} @other_user.`;
  const parts = linkifyMentions(text);
  assert.equal(parts.map((part) => part.text).join(''), text);
  assert.deepEqual(
    parts.filter((part) => part.username).map((part) => part.username),
    ['username_12', 'a', 'z'.repeat(32), 'other_user'],
  );
});

test('mentions exclude email addresses, embedded names, doubled @ and overlong or non-ASCII usernames', () => {
  const text = `mail@example.com abc@user @@user @${'x'.repeat(33)} @ @éclair @nameé 文@name`;
  const parts = linkifyMentions(text);
  assert.equal(parts.map((part) => part.text).join(''), text);
  assert.equal(
    parts.some((part) => part.username),
    false,
  );
});

test('username mentions do not split URLs, credentials, or app links', () => {
  const text =
    'https://example.org/@someone?to=@other www.example.org/@name ftp://user@host/file @outside';
  const parts = linkifyMentions(text);
  assert.equal(parts.map((part) => part.text).join(''), text);
  assert.deepEqual(
    parts.filter((part) => part.username).map((part) => part.username),
    ['outside'],
  );
  assert.equal(parts.filter((part) => part.href).length, 3);
});
