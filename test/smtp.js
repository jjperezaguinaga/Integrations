"use strict";

const datafire = require('datafire');
const smtp = require('../integrations/manual/smtp').actions;
const expect = require('chai').expect;
const fs = require('fs');
const SMTPServer = require('smtp-server').SMTPServer;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const TEMP_DATABASE = './fennel.sqlite';

const CREDS = {
  host: 'localhost',
  port: 3333,
  username: 'username',
  password: 'password',
}

let lastMessage = null;

const server = new SMTPServer({
  secure: false,
  onData(stream, session, callback) {
    lastMessage = {session: JSON.parse(JSON.stringify(session)), message: ''};
    stream.on('data', buf => {
      lastMessage.message += buf.toString();
    })
    stream.on('end', callback);
  },
  onAuth(auth, session, callback) {
    if (auth.username !== CREDS.username || auth.password !== CREDS.password) {
      return callback(new Error("Invalid credentials"));
    }
    return callback(null, {user: auth.username});
  },
});

describe("SMTP", () => {
  before(done => server.listen(CREDS.port, done));
  after(done => {
    if (fs.existsSync(TEMP_DATABASE)) {
      fs.unlinkSync(TEMP_DATABASE);
    }
    return server.close(done)
  });

  it('should send a message', () => {
    let context = new datafire.Context({
      accounts: {
        smtp: CREDS,
      }
    });
    return smtp.send({
      from: 'me@example.com',
      to: ['you@example.com'],
      subject: 'hi there',
      text: 'hello!',
    }, context)
    .then(data => {
      expect(data.accepted).to.deep.equal(['you@example.com']);
      expect(data.response).to.equal('250 OK: message queued');
      expect(lastMessage).to.not.equal(null);
      expect(lastMessage.session.envelope.mailFrom).to.deep.equal({address: 'me@example.com', args: false});
      expect(lastMessage.session.envelope.rcptTo).to.deep.equal([{address: 'you@example.com', args: false}]);
      let lines = lastMessage.message.split('\r\n');
      let from = lines.filter(l => l.startsWith('From:')).pop();
      let to = lines.filter(l => l.startsWith('To:')).pop();
      let subj = lines.filter(l => l.startsWith('Subject:')).pop();
      let firstBlank = lines.indexOf('');
      let lastBlank = lines.lastIndexOf('');
      let message = lines.slice(firstBlank + 1, lastBlank).join('\n');

	  expect(from).to.equal('From: me@example.com');
      expect(to).to.equal('To: you@example.com');
      expect(subj).to.equal('Subject: hi there');
      expect(message).to.equal('hello!');
    });
  });

  it('should send attachments', () => {
    let context = new datafire.Context({
      accounts: {
        smtp: CREDS,
      }
    });
    return smtp.send({
      from: 'me@example.com',
      to: ['you@example.com'],
      text: 'this is the message body',
      attachments: [{
        content: 'this is an attachment',
        filename: 'hello.txt',
      }]
    }, context)
    .then(data => {
      expect(data.accepted).to.deep.equal(['you@example.com']);
      expect(data.response).to.equal('250 OK: message queued');
      expect(lastMessage).to.not.equal(null);
      let lines = lastMessage.message.split('\r\n');
      let lastLine = lines.pop();
      lastLine = lines.pop();
      lastLine = lines.pop();
      let contents = new Buffer(lastLine, 'base64').toString('utf8');
      expect(contents).to.equal('this is an attachment');
    })
  })
})
