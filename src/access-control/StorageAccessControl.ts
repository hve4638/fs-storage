import { AccessTree, StorageAccess, NEXT_STORAGE_ACCESS_TYPE_BIT, StorageAccessControlEvent } from './types';
import { IAccessor } from '../accessor';
import { AccessDeniedError, DirectoryAccessError, NotRegisterError, StorageAccessError } from './errors';

const StorageAccessName = {
    [StorageAccess.BINARY] : 'BINARY',
    [StorageAccess.JSON] : 'JSON',
    [StorageAccess.TEXT] : 'TEXT',
} as const;

class StorageAccessControl {
    #events:StorageAccessControlEvent;
    #nextTypeBit:number = NEXT_STORAGE_ACCESS_TYPE_BIT;
    #accessTree:AccessTree = {};

    constructor(events:StorageAccessControlEvent) {
        this.#events = events;
    }

    register(tree:AccessTree) {
        this.#accessTree = tree;
    }
    
    addAccessType():number {
        const typeBit = this.#nextTypeBit;
        if (this.#nextTypeBit >= StorageAccess.ANY) {
            throw new StorageAccessError(`Max access type reached`);
        }
        else {
            this.#nextTypeBit <<= 1;
            return typeBit;
        }
    }
    
    access(identifier:string, accessType:number):IAccessor {
        const identifiers = this.#splitIdentifier(identifier);

        // 접근 권한 확인
        let subtree = this.#accessTree;
        const length = identifiers.length;
        for (let i = 0; i < length-1; i++) {
            subtree = this.#findSubtree(identifiers[i].name, subtree);
        }
        this.#checkIsFileAccessible(identifiers[length-1].name, subtree, accessType);

        // 실제 접근
        for (let i = 0; i < length-1; i++) {
            this.#events.onAccessDir(identifiers[i].full);
        }
        return this.#events.onAccess(identifiers[length-1].full, accessType);
    }

    release(identifier:string, accessType:number|undefined) {
        const bit = this.getRegisterBit(identifier);

        if (accessType != undefined) {
            const { allowed, denied } = this.#compareAccessTypes(bit, accessType);
            if (denied !== 0) {
                throw new AccessDeniedError(`FSStorage '${identifier}' is not accessible. '${StorageAccessName[denied] ?? 'UNKNOWN'}'`);
            }
        }
        this.#events.onRelease(identifier);
    }

    releaseDir(identifier:string) {
        const bit = this.getRegisterBit(identifier);

        if (bit !== StorageAccess.DIR) {
            throw new DirectoryAccessError(`FSStorage '${identifier}' is not directory.`);
        }
        this.#events.onReleaseDir(identifier);
    }

    getRegisterBit(identifier:string):number {
        const identifiers = this.#splitIdentifier(identifier);

        // 접근 권한 확인
        let subtree = this.#accessTree;
        const length = identifiers.length;
        for (let i = 0; i < length-1; i++) {
            subtree = this.#findSubtree(identifiers[i].name, subtree);
        }

        return this.#getRegisterBit(identifiers[length-1].name, subtree);
    }

    #findSubtree(dirIdentifier:string, tree:AccessTree) {        
        if (tree[dirIdentifier] != undefined) {
            if (typeof tree[dirIdentifier] === 'number') {
                throw new DirectoryAccessError(`Directory storage '${dirIdentifier}' is not accessible.`);
            }
            else {
                return tree[dirIdentifier];
            }
        }
        else if (tree['*'] != undefined && typeof tree['*'] !== 'number') {
            return tree['*'];
        }
        else if (tree['**/*'] == undefined) {
            throw new NotRegisterError(`FSStorage '${dirIdentifier}' is not registered.`);
        }
        else {
            return {
                '**/*' : tree['**/*'],
            };
        }
    }
    
    #getRegisterBit(atomIdentifier:string, tree:AccessTree):number {
        function getItemBit(item:number|AccessTree):number {
            if (typeof item === 'object') {
                return StorageAccess.DIR;
            }
            else {
                return item;
            }
        }

        if (tree[atomIdentifier] != undefined) {
            return getItemBit(tree[atomIdentifier]);
        }
        else if (tree['*'] != undefined) {
            return getItemBit(tree['*']);
        }
        else if (tree['**/*'] != undefined) {
            return getItemBit(tree['**/*']);
        }
        else {
            return StorageAccess.NOTHING;
        }
    }
    
    #checkIsFileAccessible(atomIdentifier:string, tree:AccessTree, accessType:number) {
        // @TODO : 리팩토링 필요
        // #getRegisterBit()와 기능 중복
        const check = (treeItem:number|AccessTree, accessType:number) => {
            if (typeof treeItem === 'object') {
                throw new DirectoryAccessError(`FSStorage '${atomIdentifier}' is directory.`);
            }
            else if (this.#compareAccessTypes(treeItem, accessType).denied !== 0) {
                throw new AccessDeniedError(`FSStorage '${atomIdentifier}' is not accessible. '${StorageAccessName[accessType] ?? 'UNKNOWN'}'`);
            }
        }

        if (tree[atomIdentifier] != undefined) {
            check(tree[atomIdentifier], accessType);
        }
        else if (tree['*'] != undefined) {
            check(tree['*'], accessType);
        }
        else if (tree['**/*'] != undefined) {
            check(tree['**/*'], accessType);
        }
        else {
            throw new NotRegisterError(`FSStorage '${atomIdentifier}' is not registered.`);
        }
    }

    #compareAccessTypes(allowAccessTypes:number, accessTypes:number):{allowed:number, denied:number} {
        const allowed = allowAccessTypes & accessTypes;
        const denied = accessTypes & ~allowed;
        return { allowed, denied };
    }
    
    #splitIdentifier(identifier:string):{name:string, full:string}[] {
        const splitted = identifier.split(':');
        return splitted.map((_: any, index: number) => (
            {
                name : splitted[index],
                full : splitted.slice(0, index + 1).join(':')
            }
        ));
    }
}

export default StorageAccessControl;