# Synchronization FTP (Node.js)

Terminal application for synchronization contents the local folder with the remote folder via FTP.

Implemented: analysis contents differences, execute multithread tasks, check result and several attempts for unsuccessful operations. Detailed logging all actions.

Menu actions:
* **'Synchronize Local to FTP'** - synchronization with current remote content.
* **'Synchronize Local to FTP (use keeped remote data)'** - use saved previous actions results for synchronization. If you changed manually remote content, these actions will be incorrect.

All settings are given in "sync-cfg.js":
* pathLocalFolder - path local folder to sychronize
* pathRemoteFolder - path remote folder to sychronize
* fileKeepContent - file name for keep data content
* confirmActions - before launch actions out to log planned actions and waiting for confirmation
* excludeContent - content masks to exclude from processing. Are set relatively pathLocalFolder or pathRemoteFolder for local or remote content respectively. Example: '\*.ext', 'folder\*', '\*/folder\*', '\*name\*', 'name.ext', etc.
* ftpParams 
    * connection - connection settings
    * numThreads - number of simultaneous actions streams
    * limTryAction - number attempts for failed actions
    * limTryRequest - number attempts for failed requests
    * timeOutTransfer - time out for transfer requests (read/write files)
    * timeOutRequest - time out for other requests    
* logParams
    * fileName - file name for logging actions