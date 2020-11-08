const path = require('path')
const glob = require('glob')
const fs = require('fs')
const merge = require('merge')
const md5 = require('md5')

const SessionLog = require('./SessionLog.js')
const FtpConnect = require('./FtpConnect.js')
const TasksThreads = require('./TasksThreads.js')
const Terminal = require('./Terminal.js')

module.exports = class ContentWork {

    constructor(config) {
        this.params = config

        this.sessionLog = new SessionLog(this.params.logParams, false)
        this.ftpConnect = new FtpConnect(this.params.ftpParams, this.sessionLog)

        this.isCorrectConnect = false
        this.remoteContent = null
        this.localContent = null
        this.tasksThreads = null

        process.on('unhandledRejection', (err) => this.sessionLog.error(err.toString()))
    }

    async synchronizeToFtp(isUseKeepRemoteData) {    
        if (await this.checkConnect()) {
            this.sessionLog.begin()
            this.sessionLog.outService('START SYNCHRONIZE LOCAL CONTENT TO FTP' + (isUseKeepRemoteData ? ' (use keeped remote data)\n' : '\n'))

            if (isUseKeepRemoteData) {
                let pathFile = path.join(__dirname, '..', this.params.fileKeepRemoteContent)
                this.remoteContent = await fs.promises.readFile(pathFile)
                    .then((data) => JSON.parse(data.toString()))
                    .catch(() => this.sessionLog.error(`Unable to read file "${pathFile}"`))
            } else do {
                ContentWork.outProgressBar('Get remote content')            
                this.remoteContent = null
                if (!await this.getRemoteContent() && (await Terminal.inputConfirm('Fail get remote content. Try again? [Y/N]', ['Y', 'N'], 'Y') === 'N')) break                    
            } while(!this.remoteContent)

            if (this.remoteContent) {
                this.getLocalContent()
                await this.processing()
            }

            this.sessionLog.outService('COMPLETE')
        }
    }

    async checkConnect() {        
        if (!this.isCorrectConnect) {
            let password = this.params.ftpParams.connection.password || ''
            if (password.length == 0) password = await Terminal.inputString('\nEnter password for FTP-account')
    
            if (password.length > 0) {                
                process.stdout.write('\nCheck connect...\n')

                let remoteRoot = await this.getRemoteList('', {
                    connection: { password: password },                     
                    limTryAction: 1,
                    limTryRequest: 1,
                    timeOutRequest: 7000
                })

                this.isCorrectConnect = (remoteRoot.data && !remoteRoot.error)

                if (this.isCorrectConnect) this.params.ftpParams.connection.password = password
                else await Terminal.throwError(`Unable to establish a connection (${remoteRoot.error})\nCheck connection parameters`, false, 'Press any key to return to main menu...')
            }
        }

        return this.isCorrectConnect
    }
    
    getLocalContent() {
        ContentWork.outProgressBar('Get local content')

        let res = { folders: [], files: {} }
        let pathRoot = path.join(__dirname, this.params.pathLocalFolder)

        let listContent = glob.sync(path.join(pathRoot, '**/*'))
        listContent.forEach((pathItem, ind) => {
            ContentWork.outProgressBar('Get local content', ind, listContent.length)

            let pathRelative = path.normalize(pathItem).replace(pathRoot + path.sep, '')
            let statsItem = fs.statSync(pathItem)
            
            if (statsItem.isFile()) res.files[pathRelative] = { size: statsItem.size }
            else res.folders.push(pathRelative)
        })

        this.localContent = res
    }

    async getRemoteContent(currentFolder) {
        let listContent = await this.getRemoteList(currentFolder || '')
        if (listContent.data) {
            if (!currentFolder) this.remoteContent = { folders: [], files: {} }

            for (let ind in listContent.data) {                
                if (!currentFolder) ContentWork.outProgressBar('Get remote content', Number(ind), listContent.data.length)

                let item = listContent.data[ind]
                if (!['.', '..'].includes(item.name)) {
                    let pathItem = path.join(currentFolder || '', item.name)

                    if (item.type === 'd') {
                        if (!this.remoteContent.folders.includes(pathItem)) this.remoteContent.folders.push(pathItem)
                        if (!await this.getRemoteContent(pathItem)) {
                            this.remoteContent = null
                            break
                        }
                    } else this.remoteContent.files[pathItem] = { size: item.size }
                }                
            }
            
            return (this.remoteContent != null)
        }
    }

    async processing() {
        this.sessionLog.outService('ANALYSIS CONTENTS DIFFERENCES')

        let listDelFolders = ContentWork.getDifferentFolders(this.localContent, this.remoteContent)
        let listMakeFolders = ContentWork.getDifferentFolders(this.remoteContent, this.localContent)
        let listDelFiles = ContentWork.compareListFiles(this.localContent, this.remoteContent, false, listDelFolders)
        let listUploadFiles = ContentWork.compareListFiles(this.remoteContent, this.localContent, false)

        let needRemoteHashes = []
        let listCheckHashes = []

        ContentWork.compareListFiles(this.remoteContent, this.localContent, true).forEach(checkFile => {
            if (this.localContent.files[checkFile].size === this.remoteContent.files[checkFile].size) {
                if (!this.remoteContent.files[checkFile].hash) needRemoteHashes.push(checkFile)
                listCheckHashes.push(checkFile)
            } else {
                listDelFiles.push(checkFile)
                listUploadFiles.push(checkFile)    
            }
        })

        await this.taskGetRemoteHashes(needRemoteHashes)
        
        for (let ind in listCheckHashes) {        
            let checkFile = listCheckHashes[ind]
            if (await this.getHashLocalFile(checkFile) !== this.remoteContent.files[checkFile].hash) {
                listDelFiles.push(checkFile)
                listUploadFiles.push(checkFile)
            }
        }
        
        await this.taskDelRemoteFiles(listDelFiles)
        await this.taskDelRemoteFolders(ContentWork.excludeFolders(listDelFolders, true))
        await this.taskMakeRemoteFolders(ContentWork.excludeFolders(listMakeFolders, false))
        await this.taskUploadFiles(listUploadFiles)
        
        this.ftpConnect.closeAllConnects()

        this.sessionLog.outService('SAVE KEEP REMOTE DATA')        
        fs.writeFileSync(path.join(__dirname, '..', this.params.fileKeepRemoteContent), JSON.stringify(this.remoteContent, null, '\t'))        
    }

    async getHashLocalFile(fileName) {
        return this.localContent.files[fileName].hash || await fs.promises.readFile(path.join(__dirname, this.params.pathLocalFolder, fileName))
            .then((data) => {
                this.localContent.files[fileName].hash = md5(data)
                return this.localContent.files[fileName].hash
            })
            .catch(() => this.sessionLog.error('Unable to open file to calculate hash - ' + fileName))
    }

    async getHashRemoteFile(fileName) {
        let remoteHash = (this.remoteContent.files[fileName] && this.remoteContent.files[fileName].hash) ? this.remoteContent.files[fileName].hash : null

        if (!remoteHash) {
            let fileData = await this.getRemoteFile(fileName)
            if (fileData.data) remoteHash = md5(fileData.data)
        }

        if (remoteHash && this.remoteContent.files[fileName]) this.remoteContent.files[fileName].hash = remoteHash

        return remoteHash
    }

    async taskGetRemoteHashes(arrFiles) {
        if (arrFiles.length > 0) {
            this.outLogTaskHeader('GET HASHES REMOTE FILES', arrFiles)

            let loadSize = new Array(arrFiles.length).fill(0)

            await this.runThreads({
                title: 'Get remote files hashes',
                tryAgainConfirmHeader: 'These files have not been hashes',
                arrObjects: arrFiles,                
                command: 'get',
                isReadStream: true,

                onError: (indFile, errCode, isOverLimit) => {
                    loadSize[indFile] = 0
                    if (isOverLimit) this.sessionLog.error('Fail get hash by file - ' + arrFiles[indFile], errCode)
                },

                onProgress: (indFile, addLen) => {                    
                    loadSize[indFile] += addLen
                    this.tasksThreads.onProgress(arrFiles[indFile], Math.trunc(loadSize[indFile] / this.remoteContent.files[arrFiles[indFile]].size * 100))
                },

                forEachCallback: (indFile, buffer) => {
                    this.remoteContent.files[arrFiles[indFile]].hash = md5(buffer)
                }
            })
        }
    }

    async taskDelRemoteFiles(arrDelFiles) {
        if (arrDelFiles.length > 0) {
            this.outLogTaskHeader('DELETE REMOTE FILES', arrDelFiles)

            await this.runThreads({
                title: 'Delete remote files',
                tryAgainConfirmHeader: 'These files have not been deleted',
                arrObjects: arrDelFiles,
                command: 'delete',

                onError: (indFile, errCode, isOverLimit) => {
                    if (isOverLimit) this.sessionLog.error('Fail delete file - ' + arrDelFiles[indFile], errCode)
                },

                checkSuccess: (indFile, resultData) => {
                    if (resultData.length == 0) {
                        delete this.remoteContent.files[arrDelFiles[indFile]]
                        return true
                    }
                }
            })
        }
    }

    async taskDelRemoteFolders(arrDelFolders) {
        if (arrDelFolders.length > 0) {            
            this.outLogTaskHeader('DELETE REMOTE FOLDERS', arrDelFolders)

            await this.runThreads({
                title: 'Delete remote folders',
                tryAgainConfirmHeader: 'These folders have not been deleted',
                arrObjects: arrDelFolders,
                command: 'rmdir',
                addArg: true,

                onError: (indFolder, errCode, isOverLimit) => {
                    if (isOverLimit) this.sessionLog.error('Fail delete folder - ' + arrDelFolders[indFolder], errCode)
                },

                forEachCallback: (indFolder, data) => {
                    if (data) {
                        this.remoteContent.folders = ContentWork.excludeFolders(this.remoteContent.folders, arrDelFolders[indFolder])

                        for (let checkFile in this.remoteContent.files)
                            if (checkFile.indexOf(arrDelFolders[indFolder] + path.sep) === 0)
                                delete this.remoteContent.files[checkFile]

                    } else return false
                }
            })            
        }
    }    

    async taskMakeRemoteFolders(arrMakeFolders) {
        if (arrMakeFolders.length > 0) {    
            this.outLogTaskHeader('CREATE REMOTE FOLDERS', arrMakeFolders)
            
            await this.runThreads({
                title: 'Create remote folders',
                tryAgainConfirmHeader: 'These folders have not been created',
                arrObjects: arrMakeFolders,
                command: 'mkdir',
                addArg: true,

                onError: (indFolder, errCode, isOverLimit) => {
                    if (isOverLimit) this.sessionLog.error('Fail create folder - ' + arrMakeFolders[indFolder], errCode)
                },

                forEachCallback: (indFolder, data) => {
                    if (data) {
                        let addFolder = ''
                        let pathParts = arrMakeFolders[indFolder].split(path.sep)
    
                        for (let ind in pathParts) {                            
                            addFolder += (addFolder !== '') ? path.sep + pathParts[ind] : pathParts[ind]
                            if (!this.remoteContent.folders.includes(addFolder)) this.remoteContent.folders.push(addFolder)
                        }
                    } else return false
                }
            })            
        }
    }

    async taskUploadFiles(arrUploadFiles) {
        if (arrUploadFiles.length > 0) {
            this.outLogTaskHeader('UPLOAD FILES', arrUploadFiles)

            let uploadSize = new Array(arrUploadFiles.length).fill(0)

            await this.runThreads({
                title: 'Upload and check files',
                tryAgainConfirmHeader: 'These files have not been uploaded',
                arrObjects: arrUploadFiles,
                command: 'put',
                addArg: path.join(__dirname, this.params.pathLocalFolder),

                onError: (indFile, errCode, isOverLimit) => {
                    uploadSize[indFile] = 0
                    if (isOverLimit) this.sessionLog.error('Fail upload file - ' + arrUploadFiles[indFile], errCode)
                },

                onProgress: (indFile, addLen) => {
                    uploadSize[indFile] += addLen
                    this.tasksThreads.onProgress(arrUploadFiles[indFile], Math.trunc(uploadSize[indFile] / this.localContent.files[arrUploadFiles[indFile]].size * 100))
                },

                checkSuccess: async (indFile, resultData) => {
                    let isSuccessUploadFile = false
                    
                    if (resultData.length == 1) {
                        let fileName = arrUploadFiles[indFile]
                        this.tasksThreads.onProgress(fileName, 'TEST')
                        let remoteHash = await this.getHashRemoteFile(fileName)
                        isSuccessUploadFile = (remoteHash === await this.getHashLocalFile(fileName))

                        if (!isSuccessUploadFile) {
                            while (true)
                                if (!await this.delRemoteFile(fileName)) {
                                    delete this.remoteContent.files[fileName]
                                    break
                                }        
                        } else this.remoteContent.files[fileName] = { size: resultData[0].size, hash: remoteHash }
                    }                    
                    
                    return isSuccessUploadFile
                }
            })
        }
    }

    outLogTaskHeader(title, objsNames) {
        this.sessionLog.outService(`\n\t${objsNames.join(', ')}\n`, `${title} (x${objsNames.length})`)
    }

    getFullPathRemote(inPath) {
        if (Array.isArray(inPath)) return inPath.map(val => path.join(this.params.pathRemoteFolder, val).replace(/\\/g, '/'))
        return path.join(this.params.pathRemoteFolder, inPath).replace(/\\/g, '/')
    }

    async getRemoteList(remoteFolder, inFtpParams) {     
        let ftpParams = merge.recursive(true, this.params.ftpParams, inFtpParams || {})

        return (await this.executeTask({
            limTryAction: ftpParams.limTryAction,

            mainCommand: () => this.ftpConnect.runCommand({
                cmd: 'list',
                args: this.getFullPathRemote(remoteFolder),
                temporaryConnect: inFtpParams ? ftpParams : null
            })
        })).result
    }

    async getRemoteFile(pathFile) {
        return (await this.executeTask({
            mainCommand: () => this.ftpConnect.runCommand({
                cmd: 'get',
                args: this.getFullPathRemote(pathFile),
                isReadStream: true
            })
        })).result        
    }

    async delRemoteFile(pathFile) {
        let pathRemoteFile = this.getFullPathRemote(pathFile)

        return (await this.executeTask({
            mainCommand: () => this.ftpConnect.runCommand({
                cmd: 'delete',
                args: pathRemoteFile
            }),

            checkCommand: () => this.ftpConnect.runCommand({ 
                cmd: 'list',
                args: pathRemoteFile
            }),

            checkSuccess: (objectId, resultData) => resultData.length == 1
        })).isSuccess === true // N.B. Return exist file after operation!
    }

    runThreads(inData) {
        return new Promise(resolve => {
            this.tasksThreads = new TasksThreads()

            this.tasksThreads.runTasks({
                title: inData.title,
                tryAgainConfirmHeader: inData.tryAgainConfirmHeader,                                
                tasksItems: inData.arrObjects,
                numThreads: this.params.ftpParams.numThreads,

                execTask: (indObject) => {
                    let pathObject = this.getFullPathRemote(inData.arrObjects[indObject])
                    let cmdArgs = (inData.addArg !== undefined) 
                        ? (typeof inData.addArg === 'string' 
                            ? [path.join(inData.addArg, inData.arrObjects[indObject]), pathObject] 
                            : [pathObject].concat(inData.addArg))
                        : pathObject

                    return this.executeTask({
                        objectId: indObject,
                        checkSuccess: inData.checkSuccess,
                        forEachCallback: inData.forEachCallback,
                        onError: inData.onError,
                        
                        mainCommand: () => this.ftpConnect.runCommand({
                            cmd: inData.command,
                            args: cmdArgs,
                            isReadStream: inData.isReadStream,
                            onProgress: inData.onProgress,
                            objectId: indObject
                        }),
                        
                        checkCommand: () => this.ftpConnect.runCommand({ 
                            cmd: 'list',
                            args: pathObject
                        })
                    })
                },

                finallyTasks: () => resolve()            
            })
        })
    }

    executeTask(inData) {
        let limTryAction = inData.limTryAction || this.params.ftpParams.limTryAction

        return new Promise(async resolve => {
            let isSuccess = true
            let resCmd

            do {                
                resCmd = await inData.mainCommand()

                if (!resCmd.error) {
                    if (inData.forEachCallback) {
                        let resCallback = await inData.forEachCallback(inData.objectId, resCmd.data)
                        isSuccess = (resCallback !== undefined) ? resCallback : true
                    } else if (inData.checkSuccess) {
                        let resCheck = await inData.checkCommand()                            
                        isSuccess = (!resCheck.error) ? await inData.checkSuccess(inData.objectId, resCheck.data) : false
                    } 
                } else isSuccess = false
                
                if (!isSuccess) {
                    let isOverLimit = (--limTryAction === 0)
                    if (inData.onError) inData.onError(inData.objectId, resCmd.error, isOverLimit)
                    if (isOverLimit) break
                }
            } while (!isSuccess)

            resolve({
                objectId: inData.objectId,
                isSuccess: isSuccess,
                result: resCmd
            })
        })
    }
            
    static getDifferentFolders(baseListContent, checkListContent) {
        return checkListContent.folders.filter(folder => !baseListContent.folders.includes(folder))
            .sort((it1, it2) => (it1.split(path.sep).length > it2.split(path.sep).length) ? 1 : -1)
    }

    static compareListFiles(baseListContent, checkListContent, isSimilar, listExcludeFolders) {
        let res = []

        for (let checkFileName in checkListContent.files)
            if ((!listExcludeFolders || !listExcludeFolders.includes(path.dirname(checkFileName))) && ((isSimilar && baseListContent.files[checkFileName]) || (!isSimilar && !baseListContent.files[checkFileName])))
                res.push(checkFileName)

        return res
    }

    static excludeFolders(listFolders, exclude) {
        if (typeof exclude === 'boolean') {
            for (let indMain = 0; indMain < listFolders.length; indMain++)
                if (listFolders[indMain])
                    for (let indCheck = indMain + 1; indCheck < listFolders.length; indCheck++)
                        if (listFolders[indCheck] && (listFolders[indCheck].indexOf(listFolders[indMain] + path.sep) === 0))
                            listFolders[exclude ? indCheck : indMain] = null
        } else if (typeof exclude === 'string') {            
            for (let indCheck = 0; indCheck < listFolders.length; indCheck++)
                if (listFolders[indCheck] && ((listFolders[indCheck] === exclude) || (listFolders[indCheck].indexOf(exclude + path.sep) === 0)))
                    listFolders[indCheck] = null
        }

        return listFolders.filter(folderName => folderName)
    }

    static outProgressBar(title, currentInd = 0, maxInd = 0) {
        if (!currentInd && !maxInd) Terminal.clearScreen()

        const PANEL_WIDTH = 50
        let lenDone = Math.trunc(currentInd * (PANEL_WIDTH - 8) / Math.abs(maxInd - 1))
        
        process.stdout.write(Terminal.style.Cursor.MoveTo(0, 2))
        process.stdout.write(`┌─ ${title} ${'─'.repeat(PANEL_WIDTH - title.length - 3)}┐\n`)
        process.stdout.write('│' + ' '.repeat(PANEL_WIDTH) + '│' + '\n')
        process.stdout.write('│  ' + '▓'.repeat(lenDone) + '░'.repeat(PANEL_WIDTH - lenDone - 4) + '  │\n')
        process.stdout.write('│' + ' '.repeat(PANEL_WIDTH) + '│' + '\n')
        process.stdout.write('└' + '─'.repeat(PANEL_WIDTH) + '┘' + '\n')        
    }

}