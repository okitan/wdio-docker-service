import { expect } from 'chai';
import path from 'path';
import { stub, spy } from 'sinon';
import Docker from '../../../src/utils/docker';
import fs from 'fs-extra';
import * as ChildProcess from '../../../src/utils/child-process';
import Promise from 'bluebird';

describe('Docker', function () {

    describe('#constructor', function () {
        context('when image argument is not provided', function () {
            const tryToInstantiate = () => {
                new Docker();
            };

            it('must throw an error', function () {
                expect(tryToInstantiate).to.throw();
            });
        });

        context('when image argument is provided', function () {
            context('when optional arguments are not provided', function () {
                it('must use defaults', function () {
                    const docker = new Docker('my-image');
                    const cidfile = path.join(process.cwd(), 'my_image.cid');

                    expect(docker.args).to.eql(undefined);
                    expect(docker.cidfile).to.eql(cidfile);
                    expect(docker.command).to.eql(undefined);
                    expect(docker.debug).to.eql(false);
                    expect(docker.healthCheck).to.eql(undefined);
                    expect(docker.logger).to.eql(console);
                    expect(docker.process).to.eql(null);
                    expect(docker.options).to.eql({
                        rm: true,
                        cidfile
                    });
                });
            });

            context('when debug argument is set', function () {
                it('must set debug property', function () {
                    const docker = new Docker('my-image', { debug: true });
                    expect(docker.debug).to.eql(true);
                });
            });

            context('when docker options are set', function () {
                it('must properly translate them into a docker run command', function () {
                    const docker = new Docker('my-image', {
                        options: {
                            d: true,
                            p: ['1234:1234'],
                            foo: 'bar'
                        }
                    });

                    expect(docker.dockerRunCommand).to.eql(`docker run --cidfile ${ docker.cidfile } --rm -d -p 1234:1234 --foo bar my-image`);
                });
            });

            context('when docker command argument is provided ', function () {
                it('must place it after image name ', function () {
                    const docker = new Docker('my-image', { command: 'test' });

                    expect(docker.dockerRunCommand).to.eql(`docker run --cidfile ${ docker.cidfile } --rm my-image test`);
                });
            });

            context('when docker args argument is provided ', function () {
                it('must place it after image name ', function () {
                    const docker = new Docker('my-image', { args: '-foo' });

                    expect(docker.dockerRunCommand).to.eql(`docker run --cidfile ${ docker.cidfile } --rm my-image -foo`);
                });
            });

            context('when both command and args arguments are provided', function () {
                it('must place both of them after image name where command is followed by args', function () {
                    const docker = new Docker('my-image', { command: 'test', args: '-foo' });
                    expect(docker.dockerRunCommand).to.eql(`docker run --cidfile ${ docker.cidfile } --rm my-image test -foo`);
                });
            });
        });
    });

    describe('#stop', function () {
        const killSpy = new spy();
        let mockProcess = {
            kill: killSpy
        };

        before(function () {
            stub(Docker.prototype, '_removeStaleContainer').returns(Promise.resolve());
        });

        after(function () {
            Docker.prototype._removeStaleContainer.restore();
        });

        it('must must process', function () {
            const docker = new Docker('my-image');
            docker.process = mockProcess;

            return docker.stop().then(() => {
                expect(killSpy.called).to.eql(true);
                expect(docker.process).to.eql(null);
            });
        });
    });

    describe('#run', function () {
        const mockProcess = {
            stdout: {
                on: new spy()
            },
            stderr: {
                on: new spy()
            },
            kill: new spy()
        };

        beforeEach(function () {
            stub(ChildProcess, 'runProcess').returns(Promise.resolve(mockProcess));
            stub(Docker.prototype, '_removeStaleContainer').returns(Promise.resolve());
            stub(Docker.prototype, '_reportWhenDockerIsRunning').returns(Promise.resolve());
        });

        afterEach(function () {
            ChildProcess.runProcess.restore();
            Docker.prototype._removeStaleContainer.restore();
            Docker.prototype._reportWhenDockerIsRunning.restore();
        });

        context('when image is not yet pulled (first time)', function () {
            before(function () {
                stub(Docker.prototype, '_isImagePresent').returns(Promise.reject());
                stub(Docker.prototype, '_pullImage').returns(Promise.resolve());
            });

            after(function () {
                Docker.prototype._isImagePresent.restore();
                Docker.prototype._pullImage.restore();
            });

            it('must attempt to pull image', function () {
                const docker = new Docker('my-image');

                return docker.run().then(() => {
                    expect(Docker.prototype._pullImage.called).to.eql(true);
                });
            });
        });

        context('when image is already pulled', function () {
            before(function () {
                stub(Docker.prototype, '_isImagePresent').returns(Promise.resolve());
                spy(Docker.prototype, '_pullImage');
            });

            after(function () {
                Docker.prototype._isImagePresent.restore();
                Docker.prototype._pullImage.restore();
            });

            it('must just run the command', function () {
                const docker = new Docker('my-image');

                return docker.run().then(() => {
                    expect(Docker.prototype._pullImage.called).to.eql(false);
                    expect(ChildProcess.runProcess.called).to.eql(true);
                });
            });

            it('must emit processCreated event', function () {
                const processCreatedSpy = new spy();
                const docker = new Docker('my-image');
                docker.on('processCreated', processCreatedSpy);

                return docker.run().then(() => {
                    expect(ChildProcess.runProcess.called).to.eql(true);
                    expect(processCreatedSpy.called).to.eql(true);
                });
            });
        });

        context('when running with debug flag enabled', function () {
            const mockLogger = {
                log: spy(),
                info: spy(),
                warn: spy(),
                error: spy()
            };

            before(function () {
                stub(Docker.prototype, '_isImagePresent').returns(Promise.resolve());
            });

            after(function () {
                Docker.prototype._isImagePresent.restore();
            });

            it('must log docker run command', function () {
                const docker = new Docker('my-image', { debug: true }, mockLogger);
                return docker.run().then(() => {
                    expect(mockLogger.log.calledWith(`Docker command: docker run --cidfile ${ docker.cidfile } --rm my-image`)).to.eql(true);
                });
            });

            it('must listen to stdout data event', function () {
                const docker = new Docker('my-image', { debug: true }, mockLogger);
                return docker.run().then((process) => {
                    expect(process.stdout.on.called).to.eql(true);
                });
            });

            it('must listen to stderr data event', function () {
                const docker = new Docker('my-image', { debug: true }, mockLogger);
                return docker.run().then((process) => {
                    expect(process.stderr.on.called).to.eql(true);
                });
            });
        });
    });

    describe('#stopContainer', function () {
        before(function () {
            stub(ChildProcess, 'runCommand').returns(Promise.resolve());
        });

        after(function () {
            ChildProcess.runCommand.restore();
        });

        it('must call docker command to stop running conrainer', function () {
            return Docker.stopContainer('123').then(() => {
                expect(ChildProcess.runCommand.calledWith('docker stop 123')).to.eql(true);
            });
        });
    });

    describe('#removeContainer', function () {
        before(function () {
            stub(ChildProcess, 'runCommand').returns(Promise.resolve());
        });

        after(function () {
            ChildProcess.runCommand.restore();
        });

        it('must call docker command to stop running conrainer', function () {
            return Docker.removeContainer('123').then(() => {
                expect(ChildProcess.runCommand.calledWith('docker rm 123')).to.eql(true);
            });
        });
    });

    describe('#serializeOption', function () {
        describe('when a single letter option', function () {
            context('and is a boolean', function () {
                it('must serialize correctly', function () {
                    const option = Docker.serializeOption('d', true);
                    expect(option).to.eql('-d');
                });
            });

            context('and is a string', function () {
                it('must serialize correctly', function () {
                    const option = Docker.serializeOption('d', 'boo');
                    expect(option).to.eql('-d boo');
                });
            });

            context('and is an array', function () {
                it('must serialize correctly', function () {
                    const option = Docker.serializeOption('d', ['foo=bar', 'bar=foo']);
                    expect(option).to.eql(['-d foo=bar', '-d bar=foo']);
                });
            });
        });

        describe('when multiple-letter option', function () {
            context('and is a boolean', function () {
                it('must serialize correctly', function () {
                    const option = Docker.serializeOption('foo', true);
                    expect(option).to.eql('--foo');
                });
            });

            context('and is a string', function () {
                it('must serialize correctly', function () {
                    const option = Docker.serializeOption('foo', 'boo');
                    expect(option).to.eql('--foo boo');
                });
            });

            context('and is an array', function () {
                it('must serialize correctly', function () {
                    const option = Docker.serializeOption('doo', ['foo=bar', 'bar=foo']);
                    expect(option).to.eql(['--doo foo=bar', '--doo bar=foo']);
                });
            });
        });
    });

    describe('#serializeOptions', function () {
        it('must return an array of serialized options', function () {
            const options = {
                d: true,
                foo: true,
                boo: 'bop',
                e: ['123=345', '678=901']
            };

            expect(Docker.serializeOptions(options)).to.deep.eql([
                '-d',
                '--foo',
                '--boo bop',
                '-e 123=345',
                '-e 678=901'
            ]);
        });
    });

    describe('#_removeStaleContainer', function () {
        beforeEach(function () {
            stub(fs, 'remove').returns(Promise.resolve());
            stub(Docker, 'stopContainer').returns(Promise.resolve());
            stub(Docker, 'removeContainer').returns(Promise.resolve());
        });

        afterEach(function () {
            fs.remove.restore();
            Docker.stopContainer.restore();
            Docker.removeContainer.restore();
        });


        context('when cid file exists', function () {
            before(function () {
                stub(fs, 'readFile').returns(Promise.resolve('123'));
            });

            after(function () {
                fs.readFile.restore();
            });

            it('must remove stale container', function () {
                const docker = new Docker('my-image');

                return docker._removeStaleContainer().then(() => {
                    expect(fs.readFile.calledWith(docker.cidfile)).to.eql(true);
                    expect(fs.remove.calledWith(docker.cidfile)).to.eql(true);
                    expect(Docker.stopContainer.calledWith('123')).to.eql(true);
                    expect(Docker.removeContainer.calledWith('123')).to.eql(true);
                });
            });
        });

        context('when cid file does not exist', function () {
            before(function () {
                stub(fs, 'readFile').returns(Promise.reject());
            });

            after(function () {
                fs.readFile.restore();
            });

            it('must attempt to remove stale container', function () {
                const docker = new Docker('my-image');

                return docker._removeStaleContainer().catch(() => {
                    expect(fs.readFile.calledWith(docker.cidfile)).to.eql(true);
                    expect(fs.remove.calledWith(docker.cidfile)).to.eql(true);
                    expect(Docker.stopContainer.calledWith('123')).to.eql(false);
                    expect(Docker.removeContainer.calledWith('123')).to.eql(false);
                });
            });
        });

    });

    describe('#_pullImage', function () {
        before(function () {
            stub(ChildProcess, 'runCommand').returns(Promise.resolve());
        });

        after(function () {
            ChildProcess.runCommand.restore();
        });

        it('must call runCommand', function () {
            const docker = new Docker('my-image');
            return docker._pullImage().then(() => {
                expect(ChildProcess.runCommand.calledWith('docker pull my-image')).to.eql(true);
            });
        });
    });

    describe('#_isImagePresent', function () {
        before(function () {
            stub(ChildProcess, 'runCommand').returns(Promise.resolve());
        });

        after(function () {
            ChildProcess.runCommand.restore();
        });

        it('must call runCommand', function () {
            const docker = new Docker('my-image');
            return docker._isImagePresent().then(() => {
                expect(ChildProcess.runCommand.calledWith('docker inspect my-image')).to.eql(true);
            });
        });
    });

    describe('#_reportWhenDockerIsRunning', function () {
        context('when healthCheck is not set', function () {
            const pingDef = require('../../../src/utils/ping');

            before(function () {
                stub(pingDef, 'default').returns(Promise.reject());
                spy(global, 'clearTimeout');
            });

            after(function () {
                pingDef.default.restore();
                global.clearTimeout.restore();
            });

            it('must resolve promise right away', function () {
                const docker = new Docker('my-image');

                return docker._reportWhenDockerIsRunning().then(() => {
                    expect(global.clearTimeout.called).to.eql(true);
                    expect(pingDef.default.called).to.eql(false);
                });
            });
        });

        context('when healthCheck is provided', function () {
            const pingDef = require('../../../src/utils/ping');

            before(function () {
                stub(pingDef, 'default').returns(Promise.resolve());
                spy(global, 'clearTimeout');
            });

            after(function () {
                pingDef.default.restore();
                global.clearTimeout.restore();
            });

            it('must Ping the healthCheck url', function () {
                const docker = new Docker('my-image', { healthCheck: 'http://localhost:8080' });

                return docker._reportWhenDockerIsRunning().then(() => {
                    expect(global.clearTimeout.called).to.eql(true);
                    expect(pingDef.default.calledWith('http://localhost:8080')).to.eql(true);
                });
            });
        });

        context('when healthCheck is provided but is unreachable', function () {
            const pingDef = require('../../../src/utils/ping');

            before(function () {
                stub(pingDef, 'default').returns(Promise.reject());
                spy(global, 'clearTimeout');
            });

            after(function () {
                pingDef.default.restore();
                global.clearTimeout.restore();
            });

            it('must attempt to ping healthCheck url and then exit', function () {
                const docker = new Docker('my-image', { healthCheck: 'http://localhost:8080' });

                this.timeout(15000);

                return docker._reportWhenDockerIsRunning().catch(() => {
                    expect(global.clearTimeout.called).to.eql(true);
                    expect(pingDef.default.calledWith('http://localhost:8080')).to.eql(true);
                });
            });
        });
    });
});
