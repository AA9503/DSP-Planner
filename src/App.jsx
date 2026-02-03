import {useContext, useEffect, useState} from 'react';
import {
    ContextProvider,
    GameInfoContext
} from './contexts.jsx';
import {FactoryPlannerLayout} from './FactoryPlannerLayout.jsx';

function AppWithContexts() {
    const game_info = useContext(GameInfoContext);
    const [needs_list, set_needs_list] = useState({});

    useEffect(() => {
        set_needs_list({});
    }, [game_info]);

    return (
        <FactoryPlannerLayout 
            needs_list={needs_list} 
            set_needs_list={set_needs_list}
        />
    );
}

export default function App() {
    return <ContextProvider>
        <AppWithContexts/>
    </ContextProvider>;
}
