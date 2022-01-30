import { IFieldtypeInjection } from '../../../projects/fieldsets/fieldtypeInjection';
import { AntlersNode } from '../../../runtime/nodes/abstractNode';
import { Scope } from '../../scope/scope';
import { makeArrayVariables } from '../../variables/arrayVariables';
import { makeLoopVariables } from '../../variables/loopVariables';

const UserRolesMultipleFieldtype: IFieldtypeInjection = {
    name: 'user_roles_multiple',
    augmentScope: (symbol: AntlersNode, scope: Scope) => {
        scope.addVariables(makeArrayVariables(symbol));
        scope.addVariables(makeLoopVariables(symbol));
    }
};

export default UserRolesMultipleFieldtype;
